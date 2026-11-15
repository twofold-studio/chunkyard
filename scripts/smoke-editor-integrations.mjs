// Real Rust API/SPA + disposable shell-only Docker fixture. Never touches production data.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const { chromium } = createRequire(
  new URL("../web/package.json", import.meta.url),
)("playwright");
async function freePort(preferred = 0) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(preferred, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function gamePort() {
  // Keep Docker's published port outside Linux's client-ephemeral range: page
  // asset requests must not claim the released port before the fixture starts.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await freePort(20000 + Math.floor(Math.random() * 5000));
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No disposable game port available");
}
const directory = await mkdtemp("/tmp/chunkyard-editor-integrations-");
execFileSync(
  "docker",
  ["build", "-t", "mcm-manager-test-runtime:local", "testdata/docker-runtime"],
  { stdio: "pipe" },
);
// Keep the local-only image referenced while this host's automatic image pruning runs.
const imageGuard = execFileSync(
  "docker",
  [
    "create",
    "--label",
    "chunkyard.test=editor-integration",
    "mcm-manager-test-runtime:local",
    "/bin/true",
  ],
  { encoding: "utf8" },
).trim();
const port = await freePort(),
  base = `http://127.0.0.1:${port}`;
const manager = spawn(
  resolve("target/debug/mcm"),
  ["--data-dir", directory, "serve", "--listen", `127.0.0.1:${port}`],
  {
    env: {
      ...process.env,
      CHUNKYARD_AUTH__ENABLED: "true",
      CHUNKYARD_HTTP__PUBLIC_URL: base,
      CHUNKYARD_HTTP__UI_DIR: resolve("web/build"),
      CHUNKYARD_DOCKER__PUBLISH_IP: "127.0.0.1",
      CHUNKYARD_DOCKER__RUNTIME_IMAGE: "mcm-manager-test-runtime:local",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let stderr = "";
manager.stderr.on("data", (b) => {
  stderr = (stderr + b).slice(-3000);
});
const exited = new Promise((r) => manager.once("exit", r));
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    "/run/current-system/sw/bin/google-chrome-stable",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let fixture;
async function api(path, method = "GET", data) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: { Origin: base, "X-MCM-CSRF": "1" },
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}
async function job(path) {
  const { job } = await api(path, "POST");
  for (let i = 0; i < 100; i++) {
    const j = await api(`/api/v1/jobs/${job.id}`);
    if (j.state === "succeeded") return j;
    if (j.state === "failed") throw Error(`Fixture operation ${j.error?.code}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Fixture job timeout");
}
async function tab(name) {
  await page.getByRole("tab", { name, exact: true }).click();
}
async function shot(name) {
  await page.screenshot({
    path: `/tmp/chunkyard-011-${name}.png`,
    fullPage: !["properties-diff", "public-docs"].includes(name),
    animations: "disabled",
  });
}
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(base + "/healthz")).ok) break;
    } catch {}
    if (manager.exitCode !== null) throw Error("Manager exited: " + stderr);
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.goto(base + "/api-docs");
  await page
    .getByRole("heading", { name: "API reference", exact: true })
    .waitFor();
  assert.equal((await fetch(base + "/api/v1/openapi.json")).status, 200);
  await shot("public-docs");
  const setupToken = await readFile(resolve(directory, "setup-token"), "utf8");
  await api("/api/v1/setup", "POST", {
    setupToken,
    email: "fixture@example.com",
    password: "correct horse battery staple",
  });
  fixture = (
    await api("/api/v1/servers", "POST", {
      name: "Adventure workshop",
      port: await gamePort(),
      acceptEula: true,
      memoryMinMb: 128,
      memoryMaxMb: 256,
      cpus: 1,
    })
  ).server;
  await writeFile(
    resolve(fixture.directory, "server.jar"),
    "shell fixture, not Minecraft",
  );
  await mkdir(resolve(fixture.directory, "world/region"), { recursive: true });
  await mkdir(resolve(fixture.directory, "plugins"));
  await writeFile(resolve(fixture.directory, "notes.txt"), "Original\r\n");
  const properties = `/api/v1/servers/${fixture.id}/properties`;
  let document = await api(properties);
  document = await api(properties, "PUT", {
    content:
      "# World settings\r\nmotd=Adventure workshop\r\nwhite-list=false\r\nmax-players=10\r\n",
    etag: document.etag,
  });
  const old = document.version;
  document = await api(properties, "PUT", {
    content:
      document.content.replace("max-players=10", "max-players=20") +
      "view-distance=8\r\n",
    etag: document.etag,
  });
  await page.goto(base + "/integrations");
  await page
    .getByLabel("New key name", { exact: true })
    .fill("Disposable browser check");
  const keyResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/auth/api-keys") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const issued = await (await keyResponse).json();
  const dialog = page.getByRole("dialog", {
    name: "Copy your new API key",
    exact: true,
  });
  await dialog.waitFor();
  assert((await dialog.innerText()).includes(issued.token));
  assert.equal(
    (
      await fetch(base + "/api/v1/servers", {
        headers: { Authorization: `Bearer ${issued.token}` },
      })
    ).status,
    200,
  );
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  assert(!(await page.locator("body").innerText()).includes(issued.token));
  await page
    .getByRole("button", {
      name: "Revoke Disposable browser check",
      exact: true,
    })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Revoke key", exact: true })
    .click();
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  assert.equal(
    (
      await fetch(base + "/api/v1/servers", {
        headers: { Authorization: `Bearer ${issued.token}` },
      })
    ).status,
    401,
  );
  await shot("integrations");
  await page.goto(base + `/servers/${fixture.id}?tab=files`);
  await page.getByRole("button", { name: "world", exact: true }).click();
  await page.getByRole("button", { name: "region", exact: true }).click();
  await page.goBack();
  await page.getByRole("button", { name: "region", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "notes.txt", exact: true }).waitFor();
  await page.goForward();
  await page.getByRole("button", { name: "region", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "notes.txt", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Contents of notes.txt",
    exact: true,
  });
  await editor.waitFor();
  await page.getByRole("button", { name: "Vim", exact: true }).click();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("ggI");
  await page.keyboard.type("Vim edited: ");
  await page.keyboard.press("Escape");
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("/files/content?") && r.request().method() === "PUT",
  );
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  assert.equal((await saved).status(), 200);
  const content = await api(
    `/api/v1/servers/${fixture.id}/files/content?path=notes.txt`,
  );
  assert.equal(content.content, "Vim edited: Original\r\n");
  await shot("vim-editor");
  await tab("Properties");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("region", { name: "Version history" })
    .getByRole("button")
    .filter({ hasText: `v${old}` })
    .click();
  await page.getByTestId("properties-compare").waitFor();
  await page.getByRole("radio", { name: new RegExp("Latest") }).click();
  await page
    .getByTestId("properties-compare")
    .getByText("max-players", { exact: true })
    .waitFor();
  await page
    .getByTestId("properties-compare")
    .getByText("view-distance", { exact: true })
    .waitFor();
  await shot("properties-diff");
  await page.getByRole("button", { name: "History", exact: true }).click();
  assert.equal(await page.getByTestId("history-panel").count(), 0);
  await tab("Settings");
  assert.equal(
    await page
      .locator("header")
      .getByRole("button", { name: "Delete", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Delete", exact: true }).count(),
    1,
  );
  await job(`/api/v1/servers/${fixture.id}/start`);
  await page.reload();
  await tab("Console");
  await page
    .getByRole("log", { name: "Server console" })
    .getByText("[INFO] Green ANSI fixture", { exact: true })
    .waitFor();
  const green = page
    .getByRole("log")
    .getByText("[INFO] Green ANSI fixture", { exact: true });
  assert.notEqual(
    await green.evaluate((e) => getComputedStyle(e).color),
    await page.getByRole("log").evaluate((e) => getComputedStyle(e).color),
  );
  const command = page.getByRole("combobox", {
    name: "Console command",
    exact: true,
  });
  await command.fill("game");
  await command.press("Tab");
  await page.getByRole("listbox", { name: "Command suggestions" }).waitFor();
  await command.press("Enter");
  assert((await command.inputValue()).startsWith("gamemode"));
  assert(
    !(await import("node:fs").then(({ existsSync }) =>
      existsSync(resolve(fixture.directory, "last-command.txt")),
    )),
    "Completing must not send a command",
  );
  await command.fill("say hello from integration");
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith("/console/commands") && r.request().method() === "POST",
  );
  await command.press("Enter");
  assert.equal((await sent).status(), 204);
  await page
    .getByRole("log")
    .getByText("command: say hello from integration", { exact: false })
    .waitFor();
  const layout = await page.getByTestId("console-root").evaluate((e) => ({
    top: e.getBoundingClientRect().top,
    bottom: e.getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  assert(layout.height - layout.bottom < 80, JSON.stringify(layout));
  await shot("console");
  await context.addInitScript(() =>
    localStorage.setItem("chunkyard.metrics.intervalMs", "100"),
  );
  const metricFrames = [];
  page.on("websocket", (ws) => {
    if (ws.url().includes("/metrics/stream"))
      ws.on("framereceived", (f) => {
        try {
          const v = JSON.parse(String(f.payload));
          if (v.type === "sample") metricFrames.push(v.sample);
        } catch {}
      });
  });
  await page.goto(base + "/servers");
  await page.getByTestId("card-cpu").first().waitFor();
  for (let i = 0; i < 100 && metricFrames.length < 3; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert(metricFrames.length >= 2, "Real Docker metrics did not reach card");
  assert.equal(
    new Set(metricFrames.map((s) => s.sampledAt)).size,
    metricFrames.length,
    "Duplicate metrics were emitted",
  );
  assert.equal(metricFrames[0].serverId, fixture.id);
  await shot("server-cards");
  await page.goto(base + `/servers/${fixture.id}`);
  await page
    .getByRole("heading", { name: "Adventure workshop", exact: true })
    .waitFor();
  await page.getByText("Recent activity", { exact: true }).waitFor();
  await shot("overview");
  await page.setViewportSize({ width: 390, height: 844 });
  await tab("Console");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await shot("console-mobile");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      publicDocs: true,
      apiKeyCreateRevoke: true,
      realFileHistory: true,
      vimSaveAndCRLF: true,
      propertiesDiff: true,
      deleteInSettings: true,
      consoleColors: true,
      commandSuggestions: true,
      fullHeightConsole: true,
      realDockerStreamSamples: metricFrames.length,
      mobileNoOverflow: true,
      pageErrors: 0,
    }),
  );
} catch (error) {
  if (fixture) {
    const ids = execFileSync(
      "docker",
      ["ps", "-aq", "--filter", `label=mcm.server_id=${fixture.id}`],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const id of ids)
      console.error(
        "Disposable fixture state: " +
          execFileSync(
            "docker",
            ["inspect", "--format", "{{json .State}}", id],
            { encoding: "utf8" },
          ),
      );
  }
  throw error;
} finally {
  await browser.close();
  if (fixture) {
    // API service owns container names; resolve only containers carrying our disposable server label.
    try {
      const ids = execFileSync(
        "docker",
        ["ps", "-aq", "--filter", `label=mcm.server_id=${fixture.id}`],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const id of ids) {
        execFileSync("docker", ["stop", "--time", "3", id], {
          stdio: "ignore",
        });
        execFileSync("docker", ["rm", id], { stdio: "ignore" });
      }
    } catch {}
  }
  manager.kill("SIGTERM");
  await exited;
  execFileSync("docker", ["rm", imageGuard], { stdio: "ignore" });
  if (directory.startsWith("/tmp/chunkyard-editor-integrations-"))
    await rm(directory, { recursive: true });
}
