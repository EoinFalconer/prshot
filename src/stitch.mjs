/**
 * Stitch the before/after frames into one labelled side-by-side PNG.
 *
 * We reuse the trick from the original Sanity harness: render a tiny HTML page
 * with the two frames as data-URIs in a flex row, then screenshot that element
 * with Playwright. This avoids an ImageMagick / native-compositing dependency —
 * if you can run a headless browser to capture, you can run one to stitch.
 *
 * Playwright is an OPTIONAL peer dependency: only required when actually
 * stitching, and we surface a clear message if it's missing.
 */
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

const toUri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  )
}

function column(label, pngPath) {
  const safeLabel = escapeHtml(label)
  if (!pngPath) {
    return `<div class="col"><div class="label">${safeLabel}</div><div class="missing">(not available)</div></div>`
  }
  return `<div class="col"><div class="label">${safeLabel}</div><img src="${toUri(pngPath)}"/></div>`
}

async function loadChromium() {
  // Playwright is the consumer's optional peer dependency, so it usually lives
  // in their project's node_modules — not necessarily next to prshot. Try a
  // plain import first (works for hoisted installs), then fall back to resolving
  // it from the consumer's working directory.
  try {
    const {chromium} = await import('playwright')
    return chromium
  } catch {
    /* fall through to cwd resolution */
  }
  try {
    // Resolve playwright from the consumer's cwd. We deliberately import the
    // package's ESM entry (its `exports.import` target) rather than the file
    // `require.resolve('playwright')` returns (the CJS `main`, where `chromium`
    // hangs off the default export instead of being a named export).
    const require = createRequire(pathToFileURL(`${process.cwd()}/`))
    const pkgJson = require.resolve('playwright/package.json')
    const pkgDir = path.dirname(pkgJson)
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
    const entry =
      pkg.exports?.['.']?.import || pkg.module || pkg.main || 'index.mjs'
    const mod = await import(pathToFileURL(path.resolve(pkgDir, entry)).href)
    const chromium = mod.chromium || mod.default?.chromium
    if (!chromium) throw new Error('chromium export not found')
    return chromium
  } catch {
    throw new Error(
      'prshot needs Playwright to stitch the side-by-side image.\n' +
        '  Install it once:  npm i -D playwright && npx playwright install chromium\n' +
        '  (Playwright is an optional peer dependency, so prshot does not bundle a browser.)',
    )
  }
}

/**
 * @param {object} o
 * @param {string|null} o.beforePng  Path to the before frame, or null.
 * @param {string|null} o.afterPng   Path to the after frame, or null.
 * @param {string} o.outPng          Where to write the stitched image.
 * @param {string} o.labelBefore     Left column label.
 * @param {string} o.labelAfter      Right column label.
 * @param {{width:number,height:number}} o.viewport  Stitch canvas hint.
 */
export async function stitch({beforePng, afterPng, outPng, labelBefore, labelAfter, viewport}) {
  const chromium = await loadChromium()

  // A single-column layout (no "before") is used by --no-base captures.
  const columns = [
    beforePng !== undefined ? column(labelBefore, beforePng) : '',
    column(labelAfter, afterPng),
  ].join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f3f3f5;font:600 13px -apple-system,system-ui,sans-serif;color:#52596b}
    .row{display:flex;align-items:flex-start;gap:1px;background:#d5d8e0}
    .col{flex:1;background:#fff;padding:0;min-width:0}
    .label{padding:8px 12px;background:#1b1d28;color:#fff;letter-spacing:.04em;text-transform:uppercase}
    img{display:block;width:100%;height:auto}
    .missing{padding:40px;color:#9aa1b1;text-align:center}
  </style></head><body><div class="row" id="cap">
    ${columns}
  </div></body></html>`

  const browser = await chromium.launch()
  try {
    const pageCtx = await browser.newPage({
      viewport: {width: viewport.width, height: viewport.height},
      deviceScaleFactor: 2,
    })
    await pageCtx.setContent(html, {waitUntil: 'networkidle'})
    await pageCtx.locator('#cap').screenshot({path: outPng})
  } finally {
    await browser.close()
  }
}
