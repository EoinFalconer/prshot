# Example: plain Playwright capture

A capture command that uses Playwright directly — no test framework involved.

```bash
# 1. install Playwright (once) — prshot does not bundle a browser
npm i -D playwright && npx playwright install chromium

# 2. point capture.mjs at your subject (env or edit the file)
export TARGET_URL="http://localhost:3000/components/button"
export TARGET_SELECTOR=".my-button"   # optional: screenshot a single element

# 3. generate before/after for the current PR
prshot --capture "node examples/playwright/capture.mjs" --base origin/main
```

The only contract: `capture.mjs` writes its PNG to `process.env.EVIDENCE_OUT`.
prshot sets that env var, runs the command once on your branch (after), checks
out the PR's changed source from the base ref, runs it again (before), restores
your tree, and stitches the two frames into one labelled image.

For an API change that won't compile on the base ref, render both states in one
frame and pass `--no-base`:

```bash
prshot --no-base --capture "node examples/playwright/capture.mjs" --name button-states
```
