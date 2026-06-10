/**
 * Run the user-supplied capture command and return the produced PNG path.
 *
 * The contract is deliberately tiny and framework-agnostic: prshot sets
 * `$EVIDENCE_OUT` to a path it controls, runs the command, and expects a PNG to
 * exist there afterwards. That single env var is the entire integration surface,
 * which is why prshot works with vitest-browser, Playwright, Cypress, Puppeteer,
 * the Storybook test-runner — anything that can write a screenshot to a path.
 */
import {execSync} from 'node:child_process'
import {existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs'
import path from 'node:path'

/**
 * @param {object} o
 * @param {string} o.command   Shell command to run (uses the default shell, so
 *                             pipes/&&/env expansion all work).
 * @param {string} o.outFile   Absolute path the command must write its PNG to.
 * @param {string} o.cwd       Working directory for the command.
 * @param {string} o.label     Human label for log lines (e.g. "AFTER").
 * @returns {string} Absolute path to the produced PNG (=== o.outFile).
 */
export function runCapture({command, outFile, cwd, label}) {
  // Start from a clean slate so we never mistake a stale frame for a fresh one.
  rmSync(outFile, {force: true})
  mkdirSync(path.dirname(outFile), {recursive: true})

  process.stderr.write(`  running capture (${label}): ${command}\n`)
  execSync(command, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      // The one integration point. Both names provided for convenience.
      EVIDENCE_OUT: outFile,
      PRSHOT_OUT: outFile,
    },
  })

  if (!existsSync(outFile)) {
    throw new Error(
      `Capture command finished but no PNG was written to $EVIDENCE_OUT (${outFile}).\n` +
        `  Make sure your capture command screenshots to process.env.EVIDENCE_OUT.`,
    )
  }
  return outFile
}

/** Frame files prshot recognises in a frames directory, in sequence order. */
const FRAME_RE = /^frame-(\d+)\.png$/

/**
 * List the frame PNGs in a directory, sorted by their numeric index. prshot
 * accepts any zero-padding width (frame-0.png, frame-000.png, …) as long as the
 * names share the `frame-<n>.png` shape.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths, ordered by frame index.
 */
export function listFrames(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((f) => {
      const m = FRAME_RE.exec(f)
      return m ? {file: f, n: Number(m[1])} : null
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n)
    .map(({file}) => path.join(dir, file))
}

/**
 * GIF-mode variant of {@link runCapture}: instead of a single PNG, the capture
 * command must emit a *sequence* of frames into a directory prshot controls.
 *
 * The contract mirrors the static one but with two differences, signalled to the
 * capture command via env:
 *   - PRSHOT_GIF=1            — tells the story to run in frame-sequence mode.
 *   - EVIDENCE_OUT/PRSHOT_OUT — point at a DIRECTORY, not a file.
 *
 * The story writes `frame-000.png`, `frame-001.png`, … into that directory.
 *
 * @param {object} o
 * @param {string} o.command   Shell command to run.
 * @param {string} o.outDir    Absolute path to the frames directory.
 * @param {string} o.cwd       Working directory for the command.
 * @param {string} o.label     Human label for log lines (e.g. "AFTER").
 * @returns {string[]} Absolute paths to the produced frame PNGs, in order.
 */
export function runCaptureFrames({command, outDir, cwd, label}) {
  // Start from a clean slate so we never mix a stale sequence with a fresh one.
  rmSync(outDir, {recursive: true, force: true})
  mkdirSync(outDir, {recursive: true})

  process.stderr.write(`  running capture (${label}, gif): ${command}\n`)
  execSync(command, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PRSHOT_GIF: '1',
      // The integration point. In GIF mode this is a DIRECTORY for frames.
      EVIDENCE_OUT: outDir,
      PRSHOT_OUT: outDir,
    },
  })

  const frames = listFrames(outDir)
  if (frames.length === 0) {
    throw new Error(
      `Capture command finished but no frames were written to $EVIDENCE_OUT (${outDir}).\n` +
        `  In --gif mode your capture command must write frame-000.png, frame-001.png, …\n` +
        `  into the DIRECTORY given by process.env.EVIDENCE_OUT (PRSHOT_GIF=1 is set).`,
    )
  }
  return frames
}
