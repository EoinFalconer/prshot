/**
 * Example prshot capture command: plain Playwright.
 *
 * prshot runs this file with the env var EVIDENCE_OUT set to the PNG path it
 * wants. All this script has to do is render the subject and screenshot it to
 * that path. prshot handles the before/after orchestration around it.
 *
 * Run it via:
 *   prshot --capture "node examples/playwright/capture.mjs" --base origin/main
 *
 * The URL/selector below are placeholders — point them at your own dev server
 * or static HTML so the captured frame shows the subject IN CONTEXT (see the
 * "Writing good evidence" section of the README).
 */
import {chromium} from 'playwright'

const out = process.env.EVIDENCE_OUT
if (!out) {
  throw new Error('EVIDENCE_OUT is not set — run this through `prshot --capture`.')
}

const URL = process.env.TARGET_URL || 'http://localhost:3000/components/button'
const SELECTOR = process.env.TARGET_SELECTOR // optional: screenshot one element

const browser = await chromium.launch()
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 800}, deviceScaleFactor: 2})
  await page.goto(URL, {waitUntil: 'networkidle'})

  // Give animations/fonts a beat to settle so before/after frames are comparable.
  await page.waitForTimeout(500)

  if (SELECTOR) {
    await page.locator(SELECTOR).screenshot({path: out})
  } else {
    await page.screenshot({path: out})
  }
} finally {
  await browser.close()
}
