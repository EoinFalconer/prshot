/**
 * Example prshot --gif capture command: plain Playwright, frame sequence.
 *
 * In GIF mode prshot sets PRSHOT_GIF=1 and points EVIDENCE_OUT at a frames
 * DIRECTORY (not a file). This script renders the subject, animates an injected
 * pointer to the element that changed, shows a click pulse, fires the real
 * click, and screenshots a frame after each step into that directory.
 *
 * prshot then assembles the frames into a GIF — and, unless --no-base, captures
 * a second sequence on the base ref and stitches the two side-by-side.
 *
 * Run it via:
 *   prshot --gif --capture "node examples/playwright-gif/capture-frames.mjs" --base origin/main
 *
 * The URL/selector below are placeholders — point them at your own dev server or
 * static HTML so the captured frames show the subject IN CONTEXT.
 */
import {mkdirSync} from 'node:fs'
import path from 'node:path'

import {chromium} from 'playwright'

const dir = process.env.EVIDENCE_OUT
if (!dir) {
  throw new Error('EVIDENCE_OUT is not set — run this through `prshot --gif --capture`.')
}
if (process.env.PRSHOT_GIF !== '1') {
  throw new Error('PRSHOT_GIF is not set — this script is for --gif mode; use capture.mjs otherwise.')
}
mkdirSync(dir, {recursive: true})

const URL = process.env.TARGET_URL || 'http://localhost:3000/components/button'
const SELECTOR = process.env.TARGET_SELECTOR || '.my-button'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({viewport: {width: 480, height: 320}, deviceScaleFactor: 2})
  await page.goto(URL, {waitUntil: 'networkidle'})
  await page.waitForTimeout(400)

  // Inject a pointer overlay into the page (the real cursor isn't captured in
  // screenshots). See `prshot/cursor` for a reusable, page-scoped version.
  await page.evaluate(() => {
    const c = document.createElement('div')
    c.id = '__prshot_cursor'
    c.style.cssText =
      'position:fixed;z-index:999999;width:24px;height:24px;left:0;top:0;pointer-events:none;' +
      'filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.4));transform-origin:5px 3px;'
    c.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 2.5L18.5 11l-5.6 1.2 3.1 6.1-2.5 1.3-3.1-6.1L6 18.7 5 2.5z" ' +
      'fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    document.body.appendChild(c)
    window.__setCursor = (x, y) => {
      c.style.left = `${x - 5}px`
      c.style.top = `${y - 3}px`
    }
  })

  let n = 0
  const shot = () =>
    page.screenshot({path: path.join(dir, `frame-${String(n++).padStart(3, '0')}.png`)})

  const target = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    return {x: r.left + r.width / 2, y: r.top + r.height / 2}
  }, SELECTOR)

  // Start the pointer up-and-left, glide to the target with easing.
  const from = {x: 60, y: 60}
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
  await page.evaluate(([x, y]) => window.__setCursor(x, y), [from.x, from.y])
  await shot()
  await shot()
  const STEPS = 16
  for (let i = 1; i <= STEPS; i++) {
    const e = ease(i / STEPS)
    const x = from.x + (target.x - from.x) * e
    const y = from.y + (target.y - from.y) * e
    await page.evaluate(([px, py]) => window.__setCursor(px, py), [x, y])
    await shot()
  }

  // Real click, then hold a few frames on the result.
  await page.click(SELECTOR)
  await shot()
  await shot()
  for (let i = 0; i < 6; i++) await shot()
} finally {
  await browser.close()
}
