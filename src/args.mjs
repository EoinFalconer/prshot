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
  --open              Open the stitched PNG when done (macOS \`open\`).
  -h, --help          Show this help.

Examples:
  # vitest-browser story that screenshots to process.env.EVIDENCE_OUT
  prshot --capture "vitest run -c vitest.evidence.config.mts Dialog.evidence.tsx"

  # plain Playwright script
  prshot --capture "node capture.mjs" --base origin/main --pr 123

  # single-frame prop-toggle variant (no base checkout)
  prshot --no-base --capture "node capture-variants.mjs" --name button-states
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
