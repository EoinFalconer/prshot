/**
 * Thin, synchronous git/shell helpers.
 *
 * prshot only needs a handful of git operations, and doing them synchronously
 * keeps the orchestration linear and easy to reason about (capture → checkout →
 * capture → restore). We never run anything destructive that isn't reversed in a
 * `finally`.
 */
import {execFileSync} from 'node:child_process'

/** Run a command, capturing stdout as a trimmed string. Throws on non-zero exit. */
export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
}

/** Run a git command and return trimmed stdout. */
export function git(args, opts = {}) {
  return sh('git', args, opts).trim()
}

/** Absolute path to the repository root. */
export function repoRoot() {
  return git(['rev-parse', '--show-toplevel'])
}

/** Current branch name, or null when detached/unknown. */
export function currentBranch() {
  try {
    const name = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    return name === 'HEAD' ? null : name
  } catch {
    return null
  }
}

/**
 * Files changed between `base` and HEAD (three-dot: changes on HEAD since the
 * merge-base with `base`). This is the same set GitHub shows as "Files changed".
 */
export function changedFiles(base) {
  const out = git(['diff', '--name-only', `${base}...HEAD`])
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** True if `path` exists at `ref` (so a checkout reverts it rather than deleting it). */
export function existsAtRef(ref, path) {
  try {
    git(['cat-file', '-e', `${ref}:${path}`])
    return true
  } catch {
    return false
  }
}

/** Check out specific paths from a ref into the working tree. */
export function checkoutPaths(ref, paths) {
  if (paths.length === 0) return
  git(['checkout', ref, '--', ...paths])
}
