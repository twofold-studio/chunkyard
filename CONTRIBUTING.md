# Contributing to Chunkyard

Read [AGENTS.md](AGENTS.md) for project scope, changelog fragments, and the milestone commit workflow. Backend checks and architecture are covered in [backend development](docs/backend.md); frontend checks are in [web/README.md](web/README.md).

## README images

The README cover and gallery are composed from real app captures using the HTML/CSS in `assets/screenshots/source/`. Raw captures live in the ignored `assets/screenshots/source/shots/` directory. The renderer reads those captures; it does not log in, create records, or change a running server.

Capture the deployed app at 1600 × 900 CSS pixels with a device scale factor of two. Use real, populated views: the inventory, live resources, console, properties, files, MCP instructions, S3 storage, and settings. Collapse the sidebar to keep account details out of the images. Never capture passwords, API tokens, access keys, or private configuration. Save captures as `live-servers.png`, `live-resources.png`, `live-console.png`, `live-properties.png`, `live-files.png`, `live-integrations.png`, `live-storage.png`, and `live-settings.png` under `source/shots/`.

Render the seven composed images with Chromium and `cwebp` available:

```sh
node scripts/capture-readme.mjs
```

Install Playwright Chromium with `pnpm --dir web exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome executable. Each composition is rendered at 1600 × 1000 CSS pixels with a scale factor of two, then exported as WebP at quality 82. On NixOS, `nix shell nixpkgs#chromium nixpkgs#libwebp` supplies the rendering tools without changing the system configuration. Keep screenshots consistent with implemented behavior; raw captures are not committed.

Set `CHUNKYARD_README_PNG_DIR` to retain the composed PNGs as well. Otherwise, the renderer removes its temporary PNG output after exporting WebP. Account identifiers may be masked for publication; never replace actual application state with invented content.

The generated logo is in `assets/logo.png`, with the app copy at `web/static/logo.png`. Its generation prompt and source are recorded in [assets/brand/logo.md](assets/brand/logo.md).

Browser icons are derived from the same logo with ImageMagick:

```sh
magick assets/logo.png -background none -define icon:auto-resize=48,32,16 web/static/favicon.ico
magick assets/logo.png -resize 32x32 web/static/favicon-32.png
magick assets/logo.png -resize 180x180 web/static/apple-touch-icon.png
```
