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
import {existsSync, mkdirSync, rmSync} from 'node:fs'
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
