/**
 * Optional injected-pointer helper for prshot --gif stories.
 *
 * A GIF reads best when the viewer can *see the interaction*: a pointer gliding
 * to the thing that changed, a click pulse, then the resulting state change. The
 * browser's real cursor isn't captured in screenshots, so this injects a small
 * SVG pointer overlay into the page and animates it, capturing a frame after each
 * step. The pattern is: glide → clickPulse → (your real userEvent click) →
 * capture a few frames → optionally glide the pointer away so the result is
 * unobscured.
 *
 * This module is framework-agnostic and dependency-free. It only needs:
 *   - a DOM (it manipulates document/elements), and
 *   - a `shot()` function that screenshots the current frame to a path.
 *
 * It does NOT import vitest, Playwright, or anything else — you supply the
 * screenshot function via {@link makeShooter} (which takes a `screenshot(path)`
 * callback). That keeps it usable from vitest-browser, Playwright, Cypress, etc.
 *
 * Usage (vitest-browser):
 *   import {page} from 'vitest/browser'
 *   import {makeShooter, injectCursor, glide, clickPulse, centerOf} from 'prshot/cursor'
 *   const dir = process.env.EVIDENCE_OUT            // a directory in --gif mode
 *   const shot = makeShooter(dir, (p) => page.screenshot({path: p}))
 *   const cursor = injectCursor()
 *   await glide(cursor, centerOf(button), 16, shot)
 *   await clickPulse(cursor, shot)
 *   await userEvent.click(button)
 *   await shot()
 *
 * Usage (Playwright, page-scoped):
 *   const shot = makeShooter(dir, (p) => page.screenshot({path: p}))
 *   // inject/animate via page.evaluate, or run these in the page context.
 */

// Arrow-tip offset within the 24x24 svg, so the hotspot sits at the visual tip.
const HOTSPOT = {x: 5, y: 3}

/** Inject the SVG pointer overlay into the document and return its element. */
export function injectCursor() {
  const c = document.createElement('div')
  c.id = '__prshot_cursor'
  c.style.cssText =
    'position:fixed;z-index:999999;width:24px;height:24px;left:0;top:0;pointer-events:none;' +
    'filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.4));transform-origin:5px 3px;transition:none;'
  c.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 2.5L18.5 11l-5.6 1.2 3.1 6.1-2.5 1.3-3.1-6.1L6 18.7 5 2.5z" ' +
    'fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  document.body.appendChild(c)
  return c
}

/** Move the injected cursor so its tip sits at (x, y) in viewport coordinates. */
export function setCursor(c, x, y) {
  c.style.left = `${x - HOTSPOT.x}px`
  c.style.top = `${y - HOTSPOT.y}px`
}

/** Current cursor-tip position derived from its style. */
function cursorPos(c) {
  return {
    x: (parseFloat(c.style.left) || 0) + HOTSPOT.x,
    y: (parseFloat(c.style.top) || 0) + HOTSPOT.y,
  }
}

/** Viewport-space center of a DOM element. */
export function centerOf(el) {
  const r = el.getBoundingClientRect()
  return {x: r.left + r.width / 2, y: r.top + r.height / 2}
}

// easeInOutQuad — natural acceleration/deceleration for pointer travel.
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/**
 * Make a frame shooter that writes `frame-000.png`, `frame-001.png`, … into
 * `dir`, using the supplied `screenshot(path)` function.
 *
 * @param {string} dir  Frames directory (in --gif mode this is process.env.EVIDENCE_OUT).
 * @param {(path:string)=>Promise<unknown>|unknown} screenshot  Captures the current frame to `path`.
 * @returns {() => Promise<void>} call once per frame.
 */
export function makeShooter(dir, screenshot) {
  let n = 0
  return async () => {
    const file = `${dir}/frame-${String(n++).padStart(3, '0')}.png`
    await screenshot(file)
  }
}

/**
 * Glide the cursor from its current position to `to` over `steps` frames,
 * capturing a frame at each step.
 *
 * @param {HTMLElement} c
 * @param {{x:number,y:number}} to
 * @param {number} steps
 * @param {() => Promise<void>} shot
 */
export async function glide(c, to, steps, shot) {
  const from = cursorPos(c)
  for (let i = 1; i <= steps; i++) {
    const e = easeInOut(i / steps)
    setCursor(c, from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e)
    await shot()
  }
}

/**
 * Show a click: a blue ripple at the pointer tip plus a brief press-scale,
 * capturing a frame per ripple step. Call this right before your real click so
 * the GIF reads as "pointer clicks here".
 *
 * @param {HTMLElement} c
 * @param {() => Promise<void>} shot
 */
export async function clickPulse(c, shot) {
  const {x, y} = cursorPos(c)
  const ring = document.createElement('div')
  ring.style.cssText =
    `position:fixed;z-index:999998;left:${x}px;top:${y}px;width:8px;height:8px;` +
    'border:2px solid #2276FC;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);'
  document.body.appendChild(ring)
  const steps = [
    {s: 8, o: 0.9, press: 0.82},
    {s: 20, o: 0.7, press: 0.82},
    {s: 32, o: 0.45, press: 1},
    {s: 44, o: 0.2, press: 1},
  ]
  for (const {s, o, press} of steps) {
    ring.style.width = `${s}px`
    ring.style.height = `${s}px`
    ring.style.opacity = `${o}`
    c.style.transform = `scale(${press})`
    await shot()
  }
  ring.remove()
  c.style.transform = 'scale(1)'
}
