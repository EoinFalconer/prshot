# Example: animated before/after GIF (plain Playwright)

A `--gif` capture command that writes a *sequence* of frames — an injected
pointer gliding to a button, a click pulse, the real click, then a few hold
frames — so prshot can assemble a GIF that shows the change in motion.

```bash
# 1. install Playwright (once) — prshot does not bundle a browser
npm i -D playwright && npx playwright install chromium

# 2. ffmpeg is required for GIF assembly
brew install ffmpeg            # macOS  (sudo apt install ffmpeg on Debian/Ubuntu)

# 3. point capture-frames.mjs at your subject (env or edit the file)
export TARGET_URL="http://localhost:3000/components/button"
export TARGET_SELECTOR=".my-button"

# 4. generate a before/after GIF for the current PR
prshot --gif --capture "node examples/playwright-gif/capture-frames.mjs" --base origin/main
# → .prshot/<branch>.gif  (side-by-side: before | after)
```

## The frame contract

In `--gif` mode the integration surface changes in exactly two ways, both
signalled to your capture command via environment variables:

| Env var                      | Static mode      | `--gif` mode                          |
| ---------------------------- | ---------------- | ------------------------------------- |
| `PRSHOT_GIF`                 | _(unset)_        | `1`                                   |
| `EVIDENCE_OUT` / `PRSHOT_OUT`| a PNG **file**   | a frames **directory**                |

Your story writes `frame-000.png`, `frame-001.png`, … (zero-padded, in order)
into the directory. prshot runs it once on your branch (after), checks out the
PR's changed source from the base ref, runs it again (before), restores your
tree, and stitches the two sequences into one side-by-side GIF.

Pass `--no-base` to emit a single GIF (for a variant story that animates both
states itself).

## Knobs

```bash
prshot --gif \
  --capture "node examples/playwright-gif/capture-frames.mjs" \
  --fps 14 \                 # output frame rate (default 14)
  --gif-scale 1040 \         # output width in px (820 single / 1040 side-by-side)
  --crop 900:600:60:40       # optional ffmpeg crop W:H:X:Y on every input frame
```

## A reusable cursor helper

Hand-rolling the pointer animation is tedious. prshot ships a small,
dependency-free helper you can import — `prshot/cursor` — that does the
glide / click-pulse / shoot loop for you. See the
[main README](../../README.md#animated-before--after-gifs---gif) for the
`glide → clickPulse → real click → capture` pattern.
