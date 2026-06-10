# Example: vitest-browser capture

If you already use [vitest browser mode](https://vitest.dev/guide/browser/), you
can capture evidence with zero new infrastructure — it runs your component in
real headless Chromium via Playwright.

1. **Write an evidence story** next to the component: `Button.evidence.tsx`. It
   renders the component in the relevant state and screenshots it to
   `process.env.EVIDENCE_OUT` (see this folder's `Button.evidence.tsx`).

2. **Keep evidence stories out of your normal test suite.** The `.evidence.tsx`
   suffix + a dedicated config (`vitest.evidence.config.mts`) do this — they have
   no assertions and exist only to produce a frame.

3. **Generate before/after:**

   ```bash
   prshot --capture "vitest run -c examples/vitest-browser/vitest.evidence.config.mts examples/vitest-browser/Button.evidence.tsx" \
     --base origin/main
   ```

   prshot runs the story on your branch (after), checks out the PR's changed
   source from the base ref and re-runs the SAME story (before), restores your
   tree, and stitches a labelled side-by-side PNG.

First run only, install the browser:

```bash
npx playwright install chromium chromium-headless-shell
```
