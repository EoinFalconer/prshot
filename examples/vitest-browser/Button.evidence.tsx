/**
 * Example prshot capture: a vitest-browser "evidence story".
 *
 * This renders a component in real headless Chromium (via vitest browser mode +
 * Playwright) and screenshots it to process.env.EVIDENCE_OUT. It has no
 * assertions — it exists only to produce a frame — so keep it out of your normal
 * test glob (the `.evidence.tsx` suffix does that here).
 *
 * Run it through prshot:
 *   prshot --capture "vitest run -c vitest.evidence.config.mts examples/vitest-browser/Button.evidence.tsx"
 *
 * This file is illustrative; wire up the imports to your own component + render
 * harness.
 */
import {page} from 'vitest/browser'
import {expect, test} from 'vitest'
import {render} from 'vitest-browser-react'

// import {Button} from '../../src/Button'

test('evidence: primary button', async () => {
  // Render the subject in the state you want to document. Include enough context
  // (surrounding layout, labels) that a non-implementer understands the change.
  render(<button className="btn btn-primary">Save changes</button>)
  // render(<Button tone="primary">Save changes</Button>)

  const el = page.getByRole('button', {name: 'Save changes'})
  await expect.element(el).toBeVisible()

  // Let animations/fonts settle so before/after frames line up.
  await new Promise((r) => setTimeout(r, 500))

  // The ONLY prshot-specific line: screenshot to the path prshot provides.
  const out = process.env.EVIDENCE_OUT
  if (!out) throw new Error('EVIDENCE_OUT not set — run via `prshot --capture`.')
  await el.screenshot({path: out})
})
