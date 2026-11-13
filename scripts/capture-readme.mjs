// Capture real UI screens using temporary server records; no game containers start.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { chromium } = require("playwright");
const directory = await mkdtemp(resolve(tmpdir(), "chunkyard-cover-"));
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(
  resolve("target/debug/mcm"),
  ["--data-dir", directory, "serve", "--listen", `127.0.0.1:${port}`],
  {
    env: {
      ...process.env,
      CHUNKYARD_AUTH__ENABLED: "false",
      CHUNKYARD_HTTP__PUBLIC_URL: base,
      CHUNKYARD_HTTP__UI_DIR: resolve("web/build"),
    },
    stdio: "ignore",
  },
);
const exited = new Promise((r) => daemon.once("exit", r));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) throw new Error("Capture daemon did not become ready");
  for (const [name, gamePort, acceptEula] of [
    ["Survival", 25565, true],
    ["Creative", 25566, false],
  ]) {
    const response = await fetch(`${base}/api/v1/servers`, {
      method: "POST",
      headers: {
        Origin: base,
        "X-MCM-CSRF": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, port: gamePort, acceptEula }),
    });
    if (!response.ok)
      throw new Error("Could not create capture server records");
  }
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const shots = resolve("assets/screenshots/source/shots");
  await mkdir(shots, { recursive: true });
  await page.goto(`${base}/servers`);
  await page.getByRole("heading", { name: "Servers", exact: true }).waitFor();
  await page.getByText("Creative", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(shots, "servers.png") });
  await page.goto(`${base}/servers/new`);
  await page.getByLabel("Server name", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(shots, "create.png") });
  const cover = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  await cover.goto(
    pathToFileURL(resolve("assets/screenshots/source/hero.html")).href,
  );
  await cover
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => image.decode())),
    );
  // Canvas is only an export step, preserving the browser-rendered layout.
  await cover.screenshot({ path: resolve(shots, "hero.png") });
  console.log(
    "Captured UI and 3200 × 2000 cover; export shots/hero.png to assets/screenshots/hero.webp.",
  );
} finally {
  await browser?.close();
  daemon.kill("SIGTERM");
  const timer = setTimeout(() => daemon.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
