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
async function test(enabled, showVersion = true) {
  const liveInstall =
    process.env.CHUNKYARD_TEST_LIVE_INSTALL === "1" && !enabled && showVersion;
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
        CHUNKYARD_AUTH__ENABLED: String(enabled),
        CHUNKYARD_HTTP__SHOW_VERSION: String(showVersion),
        CHUNKYARD_HTTP__PUBLIC_URL: base,
        CHUNKYARD_HTTP__UI_DIR: resolve("web/build"),
        CHUNKYARD_DOCKER__ENABLED: String(liveInstall),
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
        .getByRole("heading", { name: "Verify the setup token", exact: true })
        .waitFor();
      assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0);
      await page
        .getByLabel("Setup token", { exact: true })
        .fill("wrong".padEnd(43, "x"));
      const rejected = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/setup/verify-token") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      assert.equal((await rejected).status(), 401);
      await page
        .getByRole("heading", { name: "Verify the setup token", exact: true })
        .waitFor();
      assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0);
      await page
        .getByLabel("Setup token", { exact: true })
        .fill(await readFile(resolve(directory, "setup-token"), "utf8"));
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page
        .getByRole("heading", { name: "Create the owner account", exact: true })
        .waitFor();
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
    // Real catalog, creation and job APIs; fix only the upstream version list so CI
    // needs no network. Docker is disabled, so the real install fails safely.
    if (!liveInstall)
      await page.route("**/api/v1/software/vanilla/versions", (route) =>
        route.fulfill({ json: { items: [{ id: "1.21.4", stable: true }] } }),
      );
    await page.goto(`${base}/servers/new`);
    await page.getByText("Vanilla", { exact: true }).click();
    if (liveInstall) {
      await page
        .getByRole("combobox", { name: "Minecraft version", exact: true })
        .click();
      await page.getByRole("option", { name: "1.21.4", exact: true }).click();
    }
    await page
      .getByLabel("Server name", { exact: true })
      .fill("Managed UI smoke");
    await page.getByLabel("Game port", { exact: true }).fill("25566");
    assert.equal(await page.getByLabel("JAR path", { exact: true }).count(), 0);
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/servers") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create and install", exact: true })
      .click();
    const createdResponse = await creation;
    assert.equal(createdResponse.status(), 201);
    const managed = (await createdResponse.json()).server;
    assert.deepEqual(managed.software, { type: "vanilla", version: "1.21.4" });
    assert.equal(managed.acceptEula, false);
    assert.equal(managed.autoJava, true);
    if (liveInstall) {
      await page.waitForURL(`**/servers/${managed.id}?created=1`, {
        timeout: 180000,
      });
      const installed = await page.evaluate(
        async (id) => await (await fetch(`/api/v1/servers/${id}`)).json(),
        managed.id,
      );
      assert.equal(installed.launch.version, "1.21.4");
      assert.equal(installed.launch.checksum.length, 40);
      assert.equal(installed.launch.javaMajor, 21);
      assert.equal(installed.acceptEula, false);
      assert.equal(installed.status.state, "stopped");
      assert.equal(installed.status.containerId, null);
    } else {
      await page
        .getByRole("button", { name: "Retry install", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Retry install", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Retry install", exact: true })
        .waitFor({ state: "visible" });
      const inventory = await page.evaluate(
        async () => await (await fetch("/api/v1/servers")).json(),
      );
      assert.equal(inventory.items.length, 1);
      assert.equal(inventory.items[0].id, managed.id);
      await page
        .getByRole("link", { name: "Open server", exact: true })
        .click();
      await page.getByRole("button", { name: "Start", exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Start", exact: true })
          .isDisabled(),
        true,
      );
      await page.unroute("**/api/v1/software/vanilla/versions");
    }
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
    if (!liveInstall)
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
    const badge = page.getByRole("button", {
      name: /Chunkyard version .*View changelog/,
    });
    if (showVersion) {
      await badge.click();
      await page
        .getByRole("dialog")
        .getByRole("heading", { name: "Changelog", exact: true })
        .waitFor();
      await page
        .getByRole("dialog")
        .getByText("Unreleased", { exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
    } else {
      const metadata = await page.evaluate(
        async () => await (await fetch("/api/v1/system/version")).json(),
      );
      assert.equal(metadata.enabled, false);
      assert.equal(await badge.count(), 0);
    }
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
  await test(false, false);
} finally {
  await browser.close();
}
