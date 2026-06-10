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
import {copyFileSync, mkdirSync, rmSync} from 'node:fs'
import path from 'node:path'

import {parseArgs, USAGE} from './args.mjs'
import {runCapture} from './capture.mjs'
import {defaultCommentBody, postToPr} from './github.mjs'
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
