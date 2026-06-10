/**
 * Assemble captured frame sequences into animated GIFs with ffmpeg.
 *
 * GIF mode is the animated sibling of the static PNG pipeline. Where static mode
 * stitches two PNGs into a side-by-side image with Playwright, GIF mode takes two
 * *frame sequences* (before & after) and stitches them into a side-by-side GIF
 * with ffmpeg — left = before, right = after, each under a colored bar, split by
 * a divider.
 *
 * Why ffmpeg (and the system one specifically): GIF needs a real palette pass
 * (palettegen/paletteuse) to look good, and the side-by-side needs the image2
 * demuxer plus pad/hstack/drawbox. The ffmpeg that ships inside Playwright is a
 * video-encode-only build that lacks the image2 demuxer, so prshot looks for a
 * system ffmpeg on PATH and fails with an actionable message if it's missing.
 */
import {execFileSync, spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {listFrames} from './capture.mjs'

// Colors for the before/after bars (RRGGBB). Deep red = before, deep green =
// after, matching the proven side-by-side recipe.
const BAR_BEFORE = '0x7A1020'
const BAR_AFTER = '0x0F5132'
const BAR_HEIGHT = 36

/**
 * Find a usable system ffmpeg. Honors $FFMPEG_PATH, else relies on PATH.
 * Throws an actionable error if none is found.
 * @returns {string} the ffmpeg executable to use.
 */
export function resolveFfmpeg() {
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean)
  for (const bin of candidates) {
    const res = spawnSync(bin, ['-version'], {stdio: 'ignore'})
    if (res.status === 0) return bin
  }
  throw new Error(
    'prshot --gif needs ffmpeg on your PATH to assemble GIFs.\n' +
      '  Install it once:  brew install ffmpeg   (macOS)\n' +
      '                    sudo apt install ffmpeg   (Debian/Ubuntu)\n' +
      '  Note: the ffmpeg bundled with Playwright is video-only and will not work;\n' +
      '  prshot needs a full system ffmpeg (image2 demuxer + pad/hstack filters).\n' +
      '  If ffmpeg lives somewhere unusual, point $FFMPEG_PATH at it.',
  )
}

/**
 * Re-stage an arbitrary frame sequence into a fresh temp dir with strict,
 * contiguous `frame-%05d.png` naming starting at 0. ffmpeg's image2 demuxer
 * needs a fixed-width, gapless numbering, but stories may pad differently (or
 * leave gaps). This normalizes both inputs of a side-by-side so they line up.
 *
 * @param {string[]} frames  Absolute frame paths, already in order.
 * @returns {{dir:string, pattern:string, count:number}}
 */
function stageFrames(frames) {
  const dir = mkdtempSync(path.join(tmpdir(), 'prshot-gif-'))
  frames.forEach((src, i) => {
    copyFileSync(src, path.join(dir, `frame-${String(i).padStart(5, '0')}.png`))
  })
  return {dir, pattern: path.join(dir, 'frame-%05d.png'), count: frames.length}
}

/** Build the per-input crop prefix for a filtergraph, or '' when no crop. */
function cropPrefix(crop) {
  return crop ? `crop=${crop},` : ''
}

/**
 * Assemble a single frames directory into one GIF.
 *
 * @param {object} o
 * @param {string} o.framesDir  Directory containing frame-NNN.png.
 * @param {string} o.outGif     Output path.
 * @param {number} o.fps        Frame rate.
 * @param {number} o.scale      Output width (px); height keeps aspect.
 * @param {string|null} o.crop  Optional ffmpeg crop "W:H:X:Y".
 * @param {string} o.ffmpeg     ffmpeg executable.
 */
export function assembleSingleGif({framesDir, outGif, fps, scale, crop, ffmpeg}) {
  const frames = listFrames(framesDir)
  if (frames.length === 0) throw new Error(`No frames found in ${framesDir}`)
  const staged = stageFrames(frames)
  try {
    const vf =
      `${cropPrefix(crop)}scale=${scale}:-1:flags=lanczos,` +
      `split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer`
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        staged.pattern,
        '-vf',
        vf,
        '-loop',
        '0',
        outGif,
      ],
      {stdio: ['ignore', 'ignore', 'inherit']},
    )
  } finally {
    rmSync(staged.dir, {recursive: true, force: true})
  }
  return outGif
}

/**
 * Stitch two frame directories into one side-by-side GIF (before | after).
 *
 * Each side gets a colored bar at the top (no text — kept portable for ffmpeg
 * builds without drawtext), the two halves are stacked horizontally, and a thin
 * black divider is drawn down the middle. The pair is scaled to `scale` width.
 *
 * @param {object} o
 * @param {string} o.beforeDir  Before frames directory.
 * @param {string} o.afterDir   After frames directory.
 * @param {string} o.outGif     Output path.
 * @param {number} o.fps        Frame rate.
 * @param {number} o.scale      Output width (px) of the combined image.
 * @param {string|null} o.crop  Optional per-input crop "W:H:X:Y".
 * @param {string} o.ffmpeg     ffmpeg executable.
 */
export function assembleSideBySideGif({beforeDir, afterDir, outGif, fps, scale, crop, ffmpeg}) {
  const beforeFrames = listFrames(beforeDir)
  const afterFrames = listFrames(afterDir)
  if (beforeFrames.length === 0) throw new Error(`No before frames in ${beforeDir}`)
  if (afterFrames.length === 0) throw new Error(`No after frames in ${afterDir}`)

  // hstack pairs frame i from each side, so different lengths would truncate to
  // the shorter. Pad the shorter sequence by repeating its last frame, so the
  // longer interaction plays in full while the shorter one holds its end state.
  const n = Math.max(beforeFrames.length, afterFrames.length)
  const padTo = (frames) => {
    const out = frames.slice()
    while (out.length < n) out.push(frames[frames.length - 1])
    return out
  }

  const beforeStaged = stageFrames(padTo(beforeFrames))
  const afterStaged = stageFrames(padTo(afterFrames))
  try {
    const cp = cropPrefix(crop)
    // Pad each input down by BAR_HEIGHT to make room for the colored top bar.
    // Using ih+BAR keeps it resolution-independent (no hard-coded frame size).
    const filter =
      `[0:v]${cp}pad=iw:ih+${BAR_HEIGHT}:0:${BAR_HEIGHT}:${BAR_BEFORE}[a];` +
      `[1:v]${cp}pad=iw:ih+${BAR_HEIGHT}:0:${BAR_HEIGHT}:${BAR_AFTER}[b];` +
      `[a][b]hstack=inputs=2,` +
      `drawbox=x=(iw/2)-1:y=0:w=2:h=ih:color=black:t=fill,` +
      `scale=${scale}:-1:flags=lanczos,` +
      `split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        beforeStaged.pattern,
        '-framerate',
        String(fps),
        '-i',
        afterStaged.pattern,
        '-filter_complex',
        filter,
        '-loop',
        '0',
        outGif,
      ],
      {stdio: ['ignore', 'ignore', 'inherit']},
    )
  } finally {
    rmSync(beforeStaged.dir, {recursive: true, force: true})
    rmSync(afterStaged.dir, {recursive: true, force: true})
  }
  return outGif
}

/** Ensure a directory exists and is empty (used for the persisted frame dirs). */
export function freshDir(dir) {
  rmSync(dir, {recursive: true, force: true})
  mkdirSync(dir, {recursive: true})
  return dir
}
