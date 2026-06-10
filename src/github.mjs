/**
 * Optionally host the stitched PNG and post it as a PR comment.
 *
 * GitHub has no image-upload API for comments, so we commit the PNG to a
 * dedicated assets branch via the Contents API and embed its raw download URL,
 * which renders inline. The assets branch keeps screenshots out of code
 * branches/CI and is safe to delete at any time.
 *
 * Everything here shells out to the authenticated `gh` CLI, so prshot inherits
 * the user's existing GitHub auth — no tokens to manage.
 */
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'

import {git, sh} from './git.mjs'

/** Ensure the assets branch exists, creating it off the base ref if missing. */
function ensureAssetsBranch(branch, base) {
  try {
    sh('gh', ['api', `repos/{owner}/{repo}/git/ref/heads/${branch}`])
  } catch {
    const baseSha = git(['rev-parse', base])
    sh('gh', [
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/git/refs',
      '-f',
      `ref=refs/heads/${branch}`,
      '-f',
      `sha=${baseSha}`,
    ])
  }
}

/** Return the blob SHA of an existing file on the branch, or undefined. */
function existingSha(remotePath, branch) {
  try {
    return sh('gh', [
      'api',
      `repos/{owner}/{repo}/contents/${remotePath}?ref=${branch}`,
      '--jq',
      '.sha',
    ]).trim()
  } catch {
    return undefined
  }
}

/**
 * Commit the PNG to the assets branch and post a PR comment linking it.
 *
 * @param {object} o
 * @param {string|number} o.pr        PR number.
 * @param {string} o.pngPath          Local path to the stitched PNG.
 * @param {string} o.assetsBranch     Branch used to host images.
 * @param {string} o.name             Slug used in the remote path.
 * @param {string} o.base             Base ref (used if the branch must be created).
 * @param {(url:string)=>string} o.commentBody  Builds the comment markdown from the raw URL.
 * @returns {string} The raw download URL of the hosted image.
 */
export function postToPr({pr, pngPath, assetsBranch, name, base, commentBody}) {
  ensureAssetsBranch(assetsBranch, base)

  const remotePath = `pr-${pr}/${name}.png`
  const sha = existingSha(remotePath, assetsBranch)

  const body = JSON.stringify({
    message: `prshot: PR #${pr} ${name}`,
    branch: assetsBranch,
    content: readFileSync(pngPath).toString('base64'),
    ...(sha ? {sha} : {}),
  })

  const res = execFileSync(
    'gh',
    ['api', '--method', 'PUT', `repos/{owner}/{repo}/contents/${remotePath}`, '--input', '-'],
    {encoding: 'utf8', input: body},
  )
  const url = JSON.parse(res).content.download_url

  execFileSync('gh', ['pr', 'comment', String(pr), '--body', commentBody(url)], {stdio: 'inherit'})
  return url
}

/** Default PR comment template. */
export function defaultCommentBody(url) {
  return (
    `### Before / after\n\n` +
    `![before-after](${url})\n\n` +
    `<sub>Generated with <a href="https://github.com/EoinFalconer/prshot">prshot</a> — ` +
    `headless render, no app/auth/data.</sub>`
  )
}
