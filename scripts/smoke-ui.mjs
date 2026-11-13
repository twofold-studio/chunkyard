// Production UI smoke: real Rust static hosting + the built SPA, no Vite.
// Run after pnpm --dir web build and cargo build -p mcm-server.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  let page;
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
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Page script error:", error.message);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes("/files"))
        console.error(
          "File API response:",
          response.status(),
          new URL(response.url()).pathname,
        );
    });
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
    await page.getByRole("button", { name: "Next", exact: true }).click();
    if (liveInstall) {
      await page
        .getByRole("combobox", { name: "Minecraft version", exact: true })
        .click();
      await page.getByRole("option", { name: "1.21.4", exact: true }).click();
    }
    await page
      .getByRole("combobox", { name: "Minecraft version", exact: true })
      .filter({ hasText: "1.21.4" })
      .waitFor();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByLabel("Server name", { exact: true })
      .fill("Managed UI smoke");
    await page
      .getByLabel("Game port (optional)", { exact: true })
      .fill("25566");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
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
        body: JSON.stringify({ name: "UI smoke" }),
      });
      if (!response.ok) throw new Error("Server record creation failed");
      return (await response.json()).server;
    });
    assert.equal(
      server.port,
      25565,
      "automatic port skips the configured 25566",
    );
    await page.goto(`${base}/servers`);
    const grid = page.getByRole("list", { name: "Servers", exact: true });
    await grid.getByTestId("server-card").first().waitFor();
    assert.equal(await grid.getByTestId("server-card").count(), 2);
    assert.equal(
      await grid
        .locator("li")
        .first()
        .getByRole("link", { name: /Create server/ })
        .count(),
      1,
      "create tile occupies the first slot when instances exist",
    );
    const card = grid
      .getByTestId("server-card")
      .filter({ hasText: "Managed UI smoke" });
    assert.match(await card.textContent(), /Vanilla/);
    assert.match(await card.textContent(), /1\.21\.4/);
    assert.match(await card.textContent(), /Port 25566/);
    await page.goto(`${base}/servers/${server.id}`);
    await page
      .getByRole("heading", { name: "Resources", exact: true })
      .first()
      .waitFor();
    if (!liveInstall)
      await page
        .getByText("Docker unavailable; no measurements.", { exact: true })
        .waitFor();
    if (liveInstall) {
      // All data belongs to this temporary manager; no game is started or EULA accepted.
      await page.getByRole("tab", { name: "Files", exact: true }).click();
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByLabel("File name", { exact: true })
        .fill("smoke.txt");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create file", exact: true })
        .click();
      const editor = page.getByRole("textbox", {
        name: "Contents of smoke.txt",
        exact: true,
      });
      await editor.fill("motd=Production UI smoke\nonline-mode=true\n");
      await page.getByRole("tab", { name: "Overview", exact: true }).click();
      await page.getByRole("tab", { name: /^Files\b/ }).click();
      assert.equal(
        await editor.inputValue(),
        "motd=Production UI smoke\nonline-mode=true\n",
      );
      const blockedNavigation = page.waitForEvent("dialog");
      const leave = page
        .getByRole("link", { name: "Java runtimes", exact: true })
        .click();
      const prompt = await blockedNavigation;
      assert.equal(prompt.type(), "confirm");
      await prompt.dismiss();
      await leave;
      assert.equal(new URL(page.url()).pathname, `/servers/${server.id}`);
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/files/content?") &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      assert.equal((await saved).status(), 200);
      assert.equal(
        await readFile(resolve(server.directory, "smoke.txt"), "utf8"),
        "motd=Production UI smoke\nonline-mode=true\n",
      );
      const downloaded = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download", exact: true }).click();
      assert.equal(
        await readFile(await (await downloaded).path(), "utf8"),
        "motd=Production UI smoke\nonline-mode=true\n",
      );
      await page.getByRole("button", { name: "Files", exact: true }).click();
      const uploaded = page.waitForResponse(
        (response) =>
          response.url().includes("/files/upload?") &&
          response.request().method() === "POST",
      );
      await page
        .getByLabel("Choose files to upload", { exact: true })
        .setInputFiles({
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("uploaded through the real UI"),
        });
      assert.equal((await uploaded).status(), 201);
      assert.equal(
        await readFile(resolve(server.directory, "notes.txt"), "utf8"),
        "uploaded through the real UI",
      );
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await page.getByLabel("Host port", { exact: true }).fill("25568");
      await page.getByLabel("Bind address", { exact: true }).fill("127.0.0.1");
      const network = page.waitForResponse(
        (response) =>
          response.url().endsWith("/network") &&
          response.request().method() === "PATCH",
      );
      await page
        .getByRole("button", { name: "Save network", exact: true })
        .click();
      assert.equal((await network).status(), 200);
      const configured = await page.evaluate(
        async (id) => (await fetch(`/api/v1/servers/${id}/network`)).json(),
        server.id,
      );
      assert.equal(configured.port, 25568);
      assert.equal(configured.publishIp, "127.0.0.1");
      await page
        .getByRole("button", { name: "Edit server.properties", exact: true })
        .click();
      await page
        .getByRole("textbox", {
          name: "Contents of server.properties",
          exact: true,
        })
        .waitFor();
    }
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
    if (liveInstall) {
      // These are this test's temporary instances. Neither has a game container.
      for (const [instance, deleteFiles] of [
        [server, false],
        [managed, true],
      ]) {
        await page.goto(`${base}/servers/${instance.id}`);
        await page.getByRole("button", { name: "Delete", exact: true }).click();
        const dialog = page.getByRole("alertdialog");
        if (deleteFiles) {
          await dialog
            .getByRole("checkbox", {
              name: "Also delete world and server files",
            })
            .check();
        }
        await dialog
          .getByRole("button", {
            name: deleteFiles ? "Delete server and files" : "Delete server",
            exact: true,
          })
          .click();
        await page.waitForURL(`${base}/servers`);
        assert.equal(
          await page.evaluate(
            async (id) => (await fetch(`/api/v1/servers/${id}`)).status,
            instance.id,
          ),
          404,
        );
        if (deleteFiles)
          await assert.rejects(stat(instance.directory), { code: "ENOENT" });
        else assert.equal((await stat(instance.directory)).isDirectory(), true);
      }
      await page
        .getByRole("link", { name: /Create server/ })
        .last()
        .waitFor();
      assert.equal(await page.getByTestId("server-card").count(), 0);
    }
    await sleep(150);
    assert.deepEqual(violations, [], "page violated its CSP");
    assert.deepEqual(errors, [], "page script errors");
    console.log(
      `PASS: same-origin static UI, ${enabled ? "owner setup/session" : "auth bypass"}, deep-link refresh, and CSP`,
    );
  } catch (error) {
    console.error(
      "UI alerts:",
      await page?.getByRole("alert").allTextContents(),
    );
    throw error;
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
