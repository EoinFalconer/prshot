/**
 * prshot — the orchestrator.
 *
 * The whole flow, in five steps:
 *   1. Run the capture command on the current branch          -> the "after" frame.
 *   2. Check out the PR's changed *source* files from the base ref and re-run the
 *      SAME capture command                                   -> the "before" frame.
 *   3. Restore the working tree (always, even on error).
 *   4. Stitch before | after into one labelled PNG via Playwright.
 *   5. Optionally host it on an assets branch and post a PR comment.
 *
 * The rendering is pluggable: prshot knows nothing about your test framework. It
 * only knows it ran a command and a PNG appeared at $EVIDENCE_OUT.
 */
import {copyFileSync, cpSync, mkdirSync, rmSync} from 'node:fs'
import path from 'node:path'

import {parseArgs, USAGE} from './args.mjs'
import {runCapture, runCaptureFrames} from './capture.mjs'
import {
  assembleSideBySideGif,
  assembleSingleGif,
  freshDir,
  resolveFfmpeg,
} from './gif.mjs'
import {defaultCommentBody, defaultGifCommentBody, postToPr} from './github.mjs'
import {checkoutPaths, currentBranch, repoRoot} from './git.mjs'
import {resolveSourceFiles} from './sources.mjs'
import {stitch} from './stitch.mjs'

const log = (msg) => process.stderr.write(`${msg}\n`)

/** Turn an arbitrary string into a filesystem-and-URL-safe slug. */
function slugify(input) {
  return (
    String(input)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'evidence'
  )
}

export async function run(argv) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (err) {
    log(err.message)
    log('')
    log(USAGE)
    return 1
  }

  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }

  if (!opts.capture) {
    log('Error: --capture is required.\n')
    log(USAGE)
    return 1
  }

  const root = repoRoot()
  const name = slugify(opts.name || currentBranch() || 'evidence')
  const outDir = path.resolve(root, opts.out)
  mkdirSync(outDir, {recursive: true})

  if (opts.gif) {
    return runGif({opts, root, name, outDir, log})
  }

  // prshot controls this path and passes it to the capture command via env.
  const captureOut = path.join(outDir, '.frame.png')
  const afterPng = path.join(outDir, `${name}.after.png`)
  const beforePng = path.join(outDir, `${name}.before.png`)
  const stitchedPng = path.join(outDir, `${name}.png`)

  const labelBefore = opts.labelBefore || `Before · ${opts.base}`
  const labelAfter = opts.labelAfter || 'After · this branch'

  log(`prshot · ${name}`)

  // ── Step 1: AFTER (current branch) ────────────────────────────────────────
  log('• Capturing AFTER (current branch)…')
  runCapture({command: opts.capture, outFile: captureOut, cwd: root, label: 'AFTER'})
  copyFileSync(captureOut, afterPng)

  // ── Step 2: BEFORE (base ref), unless --no-base ───────────────────────────
  let haveBefore = false
  if (opts.noBase) {
    log('• --no-base: single-frame capture (no base checkout).')
  } else {
    const files = resolveSourceFiles({
      base: opts.base,
      source: opts.source,
      includeTests: opts.includeTests,
    })

    if (files.length === 0) {
      log(
        `• No revertible changed source files vs ${opts.base} — skipping BEFORE.\n` +
          `  (Use --no-base for variant stories, or --source <glob> to target files.)`,
      )
    } else {
      log(`• Capturing BEFORE: checking out ${files.length} source file(s) from ${opts.base}…`)
      checkoutPaths(opts.base, files)
      try {
        runCapture({command: opts.capture, outFile: captureOut, cwd: root, label: 'BEFORE'})
        copyFileSync(captureOut, beforePng)
        haveBefore = true
      } finally {
        // ALWAYS restore the working tree, even if the before capture failed.
        log('• Restoring working tree…')
        checkoutPaths('HEAD', files)
      }
    }
  }

  // ── Step 3: stitch ────────────────────────────────────────────────────────
  log('• Stitching side-by-side…')
  await stitch({
    // For single-frame mode, omit the before column entirely (pass undefined,
    // not null — null renders a "(not available)" placeholder).
    beforePng: opts.noBase ? undefined : haveBefore ? beforePng : null,
    afterPng,
    outPng: stitchedPng,
    labelBefore,
    labelAfter,
    viewport: opts.viewport,
  })

  // Tidy the scratch frame.
  rmSync(captureOut, {force: true})

  const rel = path.relative(process.cwd(), stitchedPng)
  log(`\n✓ ${rel}`)

  // ── Step 4: optional PR comment ───────────────────────────────────────────
  if (opts.pr) {
    log(`• Posting to PR #${opts.pr}…`)
    const url = postToPr({
      pr: opts.pr,
      pngPath: stitchedPng,
      assetsBranch: opts.assetsBranch,
      name,
      base: opts.base,
      commentBody: defaultCommentBody,
    })
    log(`  posted: ${url}`)
  } else {
    log('  Re-run with --pr <number> to post it as a PR comment,')
    log('  or drag the PNG into the PR (GitHub uploads it on drop).')
  }

  // ── Step 5: optional open ─────────────────────────────────────────────────
  if (opts.open) {
    try {
      const {execFileSync} = await import('node:child_process')
      execFileSync('open', [stitchedPng])
    } catch {
      /* non-macOS or no opener — ignore */
    }
  }

  return 0
}

/**
 * GIF mode — the animated sibling of the static flow.
 *
 * Same five-step shape as static mode (capture after → checkout base → capture
 * before → restore → assemble), but:
 *   - capture emits a *sequence* of frames into a directory (PRSHOT_GIF=1), and
 *   - assembly is ffmpeg: a single GIF (--no-base) or a side-by-side GIF.
 */
async function runGif({opts, root, name, outDir, log}) {
  // Fail fast and clearly if ffmpeg is missing — before running any capture.
  const ffmpeg = resolveFfmpeg()

  // Scratch directory the capture command writes frames into (re-used per ref),
  // plus persisted per-ref copies so we still have both sequences for assembly.
  const captureFramesDir = path.join(outDir, '.frames')
  const afterFramesDir = path.join(outDir, `${name}.after.frames`)
  const beforeFramesDir = path.join(outDir, `${name}.before.frames`)
  const outGif = path.join(outDir, `${name}.gif`)

  log(`prshot · ${name} · gif`)

  // ── Step 1: AFTER (current branch) ────────────────────────────────────────
  log('• Capturing AFTER frames (current branch)…')
  runCaptureFrames({command: opts.capture, outDir: captureFramesDir, cwd: root, label: 'AFTER'})
  freshDir(afterFramesDir)
  cpSync(captureFramesDir, afterFramesDir, {recursive: true})

  // ── Step 2: BEFORE (base ref), unless --no-base ───────────────────────────
  let haveBefore = false
  if (opts.noBase) {
    log('• --no-base: single GIF (no base checkout).')
  } else {
    const files = resolveSourceFiles({
      base: opts.base,
      source: opts.source,
      includeTests: opts.includeTests,
    })

    if (files.length === 0) {
      log(
        `• No revertible changed source files vs ${opts.base} — skipping BEFORE.\n` +
          `  (Use --no-base for variant stories, or --source <glob> to target files.)`,
      )
    } else {
      log(`• Capturing BEFORE: checking out ${files.length} source file(s) from ${opts.base}…`)
      checkoutPaths(opts.base, files)
      try {
        runCaptureFrames({
          command: opts.capture,
          outDir: captureFramesDir,
          cwd: root,
          label: 'BEFORE',
        })
        freshDir(beforeFramesDir)
        cpSync(captureFramesDir, beforeFramesDir, {recursive: true})
        haveBefore = true
      } finally {
        // ALWAYS restore the working tree, even if the before capture failed.
        log('• Restoring working tree…')
        checkoutPaths('HEAD', files)
      }
    }
  }

  // ── Step 3: assemble with ffmpeg ──────────────────────────────────────────
  // Defaults differ by output shape (the side-by-side is twice as wide), and the
  // shape is decided by whether we actually got a BEFORE — not just the flag, as
  // a missing revertible-files case also falls through to a single GIF.
  if (haveBefore) {
    log('• Assembling side-by-side GIF (before | after)…')
    assembleSideBySideGif({
      beforeDir: beforeFramesDir,
      afterDir: afterFramesDir,
      outGif,
      fps: opts.fps,
      scale: opts.gifScale ?? 1040,
      crop: opts.crop,
      ffmpeg,
    })
  } else {
    log('• Assembling single GIF…')
    assembleSingleGif({
      framesDir: afterFramesDir,
      outGif,
      fps: opts.fps,
      scale: opts.gifScale ?? 820,
      crop: opts.crop,
      ffmpeg,
    })
  }

  // Tidy the scratch frames (keep the per-ref copies for inspection/re-runs).
  rmSync(captureFramesDir, {recursive: true, force: true})

  const rel = path.relative(process.cwd(), outGif)
  log(`\n✓ ${rel}`)

  // ── Step 4: optional PR comment ───────────────────────────────────────────
  if (opts.pr) {
    log(`• Posting to PR #${opts.pr}…`)
    const url = postToPr({
      pr: opts.pr,
      pngPath: outGif, // a .gif path; postToPr hosts the bytes as-is.
      assetsBranch: opts.assetsBranch,
      name,
      base: opts.base,
      commentBody: defaultGifCommentBody,
      ext: 'gif',
    })
    log(`  posted: ${url}`)
  } else {
    log('  Re-run with --pr <number> to post it as a PR comment,')
    log('  or drag the GIF into the PR (GitHub uploads it on drop).')
  }

  // ── Step 5: optional open ─────────────────────────────────────────────────
  if (opts.open) {
    try {
      const {execFileSync} = await import('node:child_process')
      execFileSync('open', [outGif])
    } catch {
      /* non-macOS or no opener — ignore */
    }
  }

  return 0
}
