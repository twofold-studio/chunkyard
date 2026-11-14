// Real Rust SPA/API + disposable Docker console fixture. Never starts Minecraft.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { chromium } = require("playwright");
async function freePort() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}
const directory = await mkdtemp(resolve(tmpdir(), "chunkyard-live-ui-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const manager = spawn(
  resolve("target/debug/mcm"),
  ["--data-dir", directory, "serve", "--listen", `127.0.0.1:${port}`],
  {
    env: {
      ...process.env,
      CHUNKYARD_AUTH__ENABLED: "false",
      CHUNKYARD_HTTP__PUBLIC_URL: base,
      CHUNKYARD_HTTP__UI_DIR: resolve("web/build"),
      CHUNKYARD_DOCKER__ENABLED: "true",
      CHUNKYARD_DOCKER__PUBLISH_IP: "127.0.0.1",
      CHUNKYARD_DOCKER__RUNTIME_IMAGE: "mcm-manager-test-runtime:local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
manager.stdout.resume();
manager.stderr.resume();
const exited = new Promise((done) => manager.once("exit", done));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
let fixture;
try {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {}
    if (manager.exitCode !== null) throw new Error("manager exited");
    await new Promise((done) => setTimeout(done, 50));
  }
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const errors = [];
  const violations = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (dialog) => {
    errors.push("Unexpected autosave prompt");
    await dialog.dismiss();
  });
  await page.exposeFunction("reportCsp", (v) => violations.push(v));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      window.reportCsp(e.effectiveDirective),
    ),
  );
  await page.goto(`${base}/servers`);
  async function api(path, method = "GET", body) {
    return page.evaluate(
      async ({ path, method, body }) => {
        const response = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json", "X-MCM-CSRF": "1" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok)
          throw new Error(`API ${method} ${path}: ${response.status}`);
        return response.status === 204 ? null : response.json();
      },
      { path, method, body },
    );
  }
  // EULA flag is fixture bookkeeping: the image is a shell console, not Minecraft.
  fixture = (
    await api("/api/v1/servers", "POST", {
      name: "Live UI fixture",
      port: await freePort(),
      acceptEula: true,
      memoryMinMb: 128,
      memoryMaxMb: 256,
    })
  ).server;
  const release = JSON.parse(await readFile(resolve("web/package.json"), "utf8")).version;
  assert.equal((await api("/api/v1/system/version")).version, release);
  assert((await api("/api/v1/system/changelog")).markdown.includes(`## ${release}`));
  await writeFile(
    resolve(fixture.directory, "server.jar"),
    "console fixture, not a Minecraft jar",
  );
  const second = (
    await api("/api/v1/servers", "POST", {
      name: "Second UI fixture",
      port: await freePort(),
    })
  ).server;
  const route = `/api/v1/servers/${fixture.id}/properties`;
  let document = await api(route);
  document = await api(route, "PUT", {
    content:
      "# preserved comment\r\nmotd=Fixture\r\nwhite-list=false\r\nonline-mode=false\r\n",
    etag: document.etag,
  });
  await page.goto(`${base}/servers/${fixture.id}`);
  await page
    .locator("header")
    .getByRole("heading", { name: "Live UI fixture", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("header")
      .getByRole("heading", { name: "Live UI fixture", exact: true })
      .count(),
    1,
  );
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const search = page.getByRole("searchbox", {
    name: "Search settings",
    exact: true,
  });
  await search.fill("motd");
  const motd = page.getByLabel("Message of the day", { exact: true });
  await motd.fill("Saved on Enter");
  let saved = page.waitForResponse(
    (r) => r.url().endsWith(route) && r.request().method() === "PUT",
  );
  await motd.press("Enter");
  assert.equal((await saved).status(), 200);
  document = await api(route);
  assert.match(document.content, /# preserved comment\r\n/);
  assert.match(document.content, /motd=Saved on Enter\r\n/);
  // Start must flush a newly typed revision, before the 900ms timer expires.
  await motd.fill("Flushed before start");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 100; attempt++) {
    document = await api(route);
    if (document.status.state === "running") break;
    await page.waitForTimeout(50);
  }
  assert.equal(document.status.state, "running");
  assert.match(document.content, /Flushed before start/);
  assert.equal(document.appliedVersion, document.version);
  assert.equal(document.restartRequired, false);
  const activeVersion = document.version;
  const activeFile = await readFile(
    resolve(fixture.directory, "server.properties"),
    "utf8",
  );
  // Edit a running instance. The JVM file stays at its prior revision.
  await motd.fill("Autosaved while running");
  saved = page.waitForResponse(
    (r) => r.url().endsWith(route) && r.request().method() === "PUT",
  );
  assert.equal((await saved).status(), 200);
  document = await api(route);
  assert.equal(document.appliedVersion, activeVersion);
  assert.equal(document.restartRequired, true);
  assert.equal(
    await readFile(resolve(fixture.directory, "server.properties"), "utf8"),
    activeFile,
  );
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  for (let attempt = 0; attempt < 100; attempt++) {
    document = await api(route);
    if (
      document.appliedVersion === document.version &&
      !document.restartRequired
    )
      break;
    await page.waitForTimeout(50);
  }
  assert.equal(document.appliedVersion, document.version);
  assert.equal(document.restartRequired, false);
  const appliedBeforeRestore = document.appliedVersion;
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: /^v1\b/ }).click();
  const restored = page.waitForResponse(
    (r) =>
      r.url().endsWith("/properties/restore") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Restore as new version", exact: true })
    .click();
  assert.equal((await restored).status(), 200);
  document = await api(route);
  assert.equal(document.appliedVersion, appliedBeforeRestore);
  assert.equal(document.restartRequired, true);
  const socketOpened = page.waitForEvent("websocket");
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  const socket = await socketOpened;
  assert(socket.url().endsWith(`/api/v1/servers/${fixture.id}/console/stream`));
  await page
    .getByRole("log", { name: "Server console", exact: true })
    .getByText(/Done/)
    .first()
    .waitFor();
  await page
    .getByLabel("Console command", { exact: true })
    .fill("say streamed-through-real-websocket");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText(/command: say streamed-through-real-websocket/)
    .waitFor();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Metrics refresh interval", exact: true })
    .click();
  await page.getByRole("option", { name: "Off", exact: true }).click();
  const manual = page.waitForResponse((r) => r.url().endsWith("/metrics"));
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  assert.equal((await manual).status(), 200);
  await page.getByRole("tab", { name: /^Properties\b/ }).click();
  await search.fill("motd");
  await motd.fill("Flushed before navigation");
  await page.getByRole("link", { name: "Java runtimes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Java runtimes", exact: true })
    .waitFor();
  assert.match((await api(route)).content, /Flushed before navigation/);
  await page.goto(`${base}/servers/${second.id}`);
  await page
    .locator("header")
    .getByRole("heading", { name: "Second UI fixture", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("header")
      .getByRole("heading", { name: "Live UI fixture", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Stop", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByText("Resources", { exact: true }).locator("..").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Min heap (MiB)", { exact: true }).fill("128");
  await page.getByLabel("Max heap (MiB)", { exact: true }).fill("384");
  await page.getByLabel("CPU limit", { exact: true }).fill("0.5");
  const savedResources = page.waitForResponse(r => r.url().endsWith("/resources") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save resources", exact: true }).click();
  assert.equal((await savedResources).status(), 200);
  const changedResources = await api(`/api/v1/servers/${second.id}`);
  assert.equal(changedResources.memoryMaxMb, 384);
  assert.equal(changedResources.cpus, 0.5);
  await page.getByRole("tab", { name: "Exports", exact: true }).click();
  await page.getByRole("radio", { name: "Full instance", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByText("Export verified", { exact: true }).first().waitFor();
  const exported = (await api("/api/v1/exports")).items.find(e => e.serverId === second.id);
  assert(exported?.sha256.length === 64);
  const attachment = await page.request.get(`${base}/api/v1/exports/${exported.id}/download`);
  assert.equal(attachment.status(), 200);
  assert.equal((await attachment.body()).length, exported.size);
  await page.getByRole("link", { name: "Storage & exports", exact: true }).click();
  await page.getByRole("heading", { name: "Storage & exports", exact: true }).waitFor();
  await page.getByText(second.name, { exact: true }).first().waitFor();
  await page.goto(`${base}/java`);
  assert.equal(
    await page
      .locator("header")
      .getByRole("heading", { name: "Second UI fixture", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, [], "script errors");
  assert.deepEqual(violations, [], "CSP violations");
  console.log(
    "PASS: contextual header, structured autosave, running-version isolation, restart application, WebSocket console, metrics preference, CPU/RAM editing and archive export/download",
  );
} finally {
  if (fixture) {
    try {
      const instance = (
        await readFile(resolve(directory, "instance-id"), "utf8")
      ).trim();
      execFileSync(
        "docker",
        ["rm", "--force", `mcm-${instance}-${fixture.id}`],
        { stdio: "ignore" },
      );
    } catch {}
  }
  await browser.close();
  manager.kill("SIGTERM");
  const timer = setTimeout(() => manager.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
  await rm(directory, { recursive: true, force: true });
}
