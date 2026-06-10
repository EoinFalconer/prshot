/**
 * CLI argument parsing for prshot.
 *
 * Kept dependency-free and explicit so the contract is easy to read and audit.
 * Every flag maps to one field on the returned options object.
 */

export const USAGE = `prshot — before/after PR screenshots with almost no overhead

Usage:
  prshot --capture "<command that writes a PNG to $EVIDENCE_OUT>" [options]

Required:
  --capture <cmd>     Shell command that renders the subject and writes a PNG to
                      the path given in the $EVIDENCE_OUT env var. This is the
                      only thing prshot needs to know about your stack — it can
                      be vitest-browser, Playwright, Cypress, Puppeteer, the
                      Storybook test-runner, or anything that can screenshot.

Options:
  --base <ref>        Git ref to diff/capture the "before" frame against.
                      Default: origin/main
  --no-base           Capture only the current state (single frame). Use this for
                      prop-toggle stories that render before & after together, or
                      for API changes where the capture won't compile on the base.
  --name <slug>       Output slug; controls file names and the assets path.
                      Default: derived from the current branch, else "evidence".
  --source <glob>     Override which changed source files get checked out from the
                      base ref before the "before" capture. Repeatable. Accepts a
                      comma-separated list too. Default: all changed tracked files
                      from \`git diff --name-only <base>...HEAD\`, minus test/story
                      files (see --include-tests).
  --include-tests     Do not exclude test/story files from the source checkout.
  --out <dir>         Output directory for the stitched PNG and frames.
                      Default: .prshot
  --pr <number>       Host the PNG on an assets branch (GitHub Contents API) and
                      post it as a PR comment. Requires the \`gh\` CLI, authed.
  --assets-branch <b> Branch used to host hosted images. Default: prshot-assets
  --label-before <s>  Override the "before" column label. Default: "Before · <base>".
  --label-after <s>   Override the "after" column label.  Default: "After · this branch".
  --viewport <WxH>    Stitch canvas width hint. Default: 2100x1200
  --open              Open the stitched image when done (macOS \`open\`).
  -h, --help          Show this help.

GIF mode (animated before/after):
  --gif               Produce an animated GIF instead of a static PNG. In this
                      mode prshot tells your capture command to emit a *sequence*
                      of frames rather than one screenshot: it sets PRSHOT_GIF=1
                      and points $EVIDENCE_OUT (and $PRSHOT_OUT) at a frames
                      DIRECTORY. Your story writes frame-000.png, frame-001.png,
                      … into that directory (zero-padded, in order). prshot then
                      assembles them into a GIF with ffmpeg, and — unless
                      --no-base — captures a second sequence on the base ref and
                      stitches the two into a side-by-side GIF (before | after).
                      Requires ffmpeg on PATH (\`brew install ffmpeg\`).
  --fps <n>           Output frame rate for the GIF. Default: 14
  --gif-scale <px>    Output width in pixels (height keeps aspect). Default: 820
                      for a single GIF, 1040 for a side-by-side.
  --crop <W:H:X:Y>    Optional ffmpeg crop applied to every input frame before
                      scaling (e.g. 900:600:60:40). Trims chrome/whitespace.

Examples:
  # vitest-browser story that screenshots to process.env.EVIDENCE_OUT
  prshot --capture "vitest run -c vitest.evidence.config.mts Dialog.evidence.tsx"

  # plain Playwright script
  prshot --capture "node capture.mjs" --base origin/main --pr 123

  # single-frame prop-toggle variant (no base checkout)
  prshot --no-base --capture "node capture-variants.mjs" --name button-states

  # animated before/after GIF of an interaction (frames -> side-by-side GIF)
  prshot --gif --capture "node capture-frames.mjs" --base origin/main --pr 123

  # single animated GIF, no base (variant that animates both states in one story)
  prshot --gif --no-base --capture "node capture-frames.mjs" --name toggle-on
`

/**
 * Parse argv (already sliced past `node script`) into an options object.
 * Throws an Error with a friendly message on bad input; the caller decides
 * whether to print usage.
 */
export function parseArgs(argv) {
  const opts = {
    capture: null,
    base: 'origin/main',
    noBase: false,
    name: null,
    source: [],
    includeTests: false,
    out: '.prshot',
    pr: null,
    assetsBranch: 'prshot-assets',
    labelBefore: null,
    labelAfter: null,
    viewport: {width: 2100, height: 1200},
    open: false,
    help: false,
    // GIF mode.
    gif: false,
    fps: 14,
    gifScale: null, // null -> mode default (820 single / 1040 side-by-side)
    crop: null, // optional ffmpeg crop "W:H:X:Y"
  }

  const needValue = (flag, value) => {
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--capture':
        opts.capture = needValue(a, argv[++i])
        break
      case '--base':
        opts.base = needValue(a, argv[++i])
        break
      case '--no-base':
        opts.noBase = true
        break
      case '--name':
        opts.name = needValue(a, argv[++i])
        break
      case '--source':
        // Repeatable, and accepts comma-separated lists in a single value.
        for (const part of needValue(a, argv[++i]).split(',')) {
          const trimmed = part.trim()
          if (trimmed) opts.source.push(trimmed)
        }
        break
      case '--include-tests':
        opts.includeTests = true
        break
      case '--out':
        opts.out = needValue(a, argv[++i])
        break
      case '--pr':
        opts.pr = needValue(a, argv[++i])
        break
      case '--assets-branch':
        opts.assetsBranch = needValue(a, argv[++i])
        break
      case '--label-before':
        opts.labelBefore = needValue(a, argv[++i])
        break
      case '--label-after':
        opts.labelAfter = needValue(a, argv[++i])
        break
      case '--viewport': {
        const v = needValue(a, argv[++i])
        const m = /^(\d+)x(\d+)$/i.exec(v)
        if (!m) throw new Error(`--viewport expects WxH (e.g. 2100x1200), got "${v}"`)
        opts.viewport = {width: Number(m[1]), height: Number(m[2])}
        break
      }
      case '--open':
        opts.open = true
        break
      case '--gif':
        opts.gif = true
        break
      case '--fps': {
        const v = needValue(a, argv[++i])
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`--fps expects a positive number, got "${v}"`)
        }
        opts.fps = n
        break
      }
      case '--gif-scale': {
        const v = needValue(a, argv[++i])
        const n = Number(v)
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--gif-scale expects a positive integer width, got "${v}"`)
        }
        opts.gifScale = n
        break
      }
      case '--crop': {
        const v = needValue(a, argv[++i])
        if (!/^\d+:\d+:\d+:\d+$/.test(v)) {
          throw new Error(`--crop expects W:H:X:Y (e.g. 900:600:60:40), got "${v}"`)
        }
        opts.crop = v
        break
      }
      case '-h':
      case '--help':
        opts.help = true
        break
      default:
        throw new Error(`Unknown argument: ${a}`)
    }
  }

  return opts
}
