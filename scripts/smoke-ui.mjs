// Production UI smoke: real Rust static hosting + the built SPA, no Vite.
// Run after pnpm --dir web build and cargo build -p mcm-server.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(enabled) {
  const directory = await mkdtemp(resolve(tmpdir(), "mcm-ui-smoke-"));
  const socket = createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  const processHandle = spawn(
    resolve(
      process.platform === "win32"
        ? "target/debug/mcm.exe"
        : "target/debug/mcm",
    ),
    ["--data-dir", directory, "serve", "--listen", `127.0.0.1:${port}`],
    {
      env: {
        ...process.env,
        MCM_AUTH__ENABLED: String(enabled),
        MCM_HTTP__PUBLIC_URL: base,
        MCM_HTTP__UI_DIR: resolve("web/build"),
        MCM_DOCKER__ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Keep daemon pipe buffers drained; never print credential-bearing bodies.
  processHandle.stdout.resume();
  processHandle.stderr.resume();
  const exited = new Promise((r) => processHandle.once("exit", r));
  let context;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (processHandle.exitCode !== null)
        throw new Error("daemon exited during startup");
      try {
        if ((await fetch(`${base}/healthz`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await sleep(50);
    }
    assert(ready, "daemon did not become ready");
    context = await browser.newContext();
    const violations = [];
    await context.exposeBinding("__reportCsp", (_, violation) =>
      violations.push(violation),
    );
    await context.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (event) =>
        window.__reportCsp({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
        }),
      ),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/servers`);
    if (enabled) {
      await page
        .getByRole("heading", { name: "Create the owner account", exact: true })
        .waitFor();
      await page
        .getByLabel("Setup token", { exact: true })
        .fill(await readFile(resolve(directory, "setup-token"), "utf8"));
      await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
      const password = randomBytes(32).toString("base64url");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Create owner", exact: true })
        .click();
    }
    await page.getByRole("heading", { name: "Servers", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Servers", exact: true }).waitFor();
    const me = await page.evaluate(
      async () => await (await fetch("/api/v1/auth/me")).json(),
    );
    assert.equal(me.authEnabled, enabled);
    if (enabled) assert.equal(me.user.email, "owner@example.com");
    else assert.equal(me.user, null);
    const server = await page.evaluate(async () => {
      const response = await fetch("/api/v1/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-MCM-CSRF": "1" },
        body: JSON.stringify({ name: "UI smoke", port: 25565 }),
      });
      if (!response.ok) throw new Error("Server record creation failed");
      return (await response.json()).server;
    });
    await page.goto(`${base}/servers/${server.id}`);
    await page
      .getByRole("heading", { name: "Resources", exact: true })
      .waitFor();
    await page
      .getByText("Docker unavailable; no measurements.", { exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Java runtimes", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Java runtimes", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("heading", { name: "Java runtimes", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "API reference", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "API reference", exact: true })
      .waitFor();
    await page.getByText("Chunkyard API", { exact: true }).first().waitFor();
    await page.reload();
    await page.getByText("Chunkyard API", { exact: true }).first().waitFor();
    await sleep(150);
    assert.deepEqual(violations, [], "page violated its CSP");
    assert.deepEqual(errors, [], "page script errors");
    console.log(
      `PASS: same-origin static UI, ${enabled ? "owner setup/session" : "auth bypass"}, deep-link refresh, and CSP`,
    );
  } finally {
    await context?.close();
    processHandle.kill("SIGTERM");
    const shutdownTimer = setTimeout(() => processHandle.kill("SIGKILL"), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(shutdownTimer);
    }
    await rm(directory, { recursive: true, force: true });
  }
}
try {
  await test(false);
  await test(true);
} finally {
  await browser.close();
}
