/**
 * Decide which source files to check out from the base ref before the "before"
 * capture.
 *
 * The before/after trick works by reverting just the *source* files the PR
 * touches, re-rendering, then restoring. We must be careful to:
 *   - skip test/story files (so the capture harness itself stays on HEAD), and
 *   - skip files that don't exist on the base ref (checkout would delete them).
 *
 * The original Sanity script hard-coded `packages/sanity/src/**` and a fixed
 * test-file pattern. Here it's fully configurable: pass explicit `--source`
 * globs, or let prshot auto-detect from the diff.
 */
import {changedFiles, existsAtRef} from './git.mjs'

// Files we never want to revert, because they belong to the capture harness and
// must stay at the HEAD version so the SAME story runs against both refs.
const TEST_LIKE = [
  /\.test\./,
  /\.spec\./,
  /\.stories\./,
  /\.story\./,
  /\.evidence\./,
  /[/\\]__tests__[/\\]/,
  /[/\\]__mocks__[/\\]/,
  /[/\\]e2e[/\\]/,
  /\.cy\./,
]

/**
 * Convert a simple glob (supporting `*`, `**`, `?`) to a RegExp anchored to the
 * full path. Intentionally small — covers the common cases without a dep.
 */
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` matches across path separators
        re += '.*'
        i++
        // swallow a trailing slash after ** so `a/**/b` matches `a/b`
        if (glob[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/**
 * Resolve the list of source files to revert.
 *
 * @param {object} o
 * @param {string} o.base            Base ref.
 * @param {string[]} o.source        Optional explicit globs (overrides auto-detect filtering).
 * @param {boolean} o.includeTests   Keep test/story files in the set.
 * @returns {string[]} repo-relative paths that exist at `base`.
 */
export function resolveSourceFiles({base, source, includeTests}) {
  let files = changedFiles(base)

  if (source.length > 0) {
    // Explicit globs: keep only changed files matching at least one glob.
    const matchers = source.map(globToRegExp)
    files = files.filter((f) => matchers.some((re) => re.test(f)))
  }

  if (!includeTests) {
    files = files.filter((f) => !TEST_LIKE.some((re) => re.test(f)))
  }

  // Only revert files that exist on the base ref. Otherwise `git checkout base`
  // would delete a file the PR added — changing more than intended.
  return files.filter((f) => existsAtRef(base, f))
}
