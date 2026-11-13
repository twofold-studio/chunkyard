# Contributing to Chunkyard

Read [AGENTS.md](AGENTS.md) for project scope, changelog fragments, and the milestone commit workflow. Backend checks and architecture are covered in [backend development](docs/backend.md); frontend checks are in [web/README.md](web/README.md).

## README images

The README cover is composed from real app captures using the HTML/CSS in `assets/screenshots/source/`. Raw captures live in the ignored `assets/screenshots/source/shots/` directory. The capture script creates temporary server records and does not start Minecraft containers.

After building the frontend and `cargo build -p mcm-server --locked`:

```sh
node scripts/capture-readme.mjs
cwebp -q 82 assets/screenshots/source/shots/hero.png -o assets/screenshots/hero.webp
```

Install Playwright Chromium with `pnpm --dir web exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome executable. The cover is rendered at 1600 × 1000 CSS pixels with a scale factor of two. Keep screenshots consistent with implemented behavior.

The generated logo is in `assets/logo.png`, with the app copy at `web/static/logo.png`. Its generation prompt and source are recorded in [assets/brand/logo.md](assets/brand/logo.md).
