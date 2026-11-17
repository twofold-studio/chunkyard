import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { chromium } = require("playwright");
const names = ["hero", "console", "properties", "files", "integrations", "storage", "settings"];
const shots = resolve("assets/screenshots/source/shots");
for (const name of ["servers", "resources", ...names.slice(1)]) {
  await access(resolve(shots, `live-${name}.png`)).catch(() => {
    throw new Error(`Missing live-${name}.png. Capture the deployed app first; see CONTRIBUTING.md.`);
  });
}
const temporary = await mkdtemp(resolve(tmpdir(), "chunkyard-readme-render-"));
const pngDirectory = process.env.CHUNKYARD_README_PNG_DIR
  ? resolve(process.env.CHUNKYARD_README_PNG_DIR)
  : temporary;
await mkdir(pngDirectory, { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {})
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await mkdir(resolve("assets/screenshots"), { recursive: true });
  for (const name of names) {
    await page.goto(pathToFileURL(resolve(`assets/screenshots/source/${name}.html`)).href);
    await page.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const png = resolve(pngDirectory, `${name}.png`);
    await page.screenshot({ path: png });
    const output = resolve(`assets/screenshots/${name}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "82", png, "-o", output], { stdio: "inherit" });
    console.log(`Rendered ${output} (3200 × 2000)`);
  }
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
