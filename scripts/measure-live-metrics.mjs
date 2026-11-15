// Measures an existing deployment without changing existing game servers.
// CHUNKYARD_TEST_ACCOUNT_ID identifies the owner's Bitwarden entry (not a password).
// Optional: CHUNKYARD_BENCH_BASE, CHUNKYARD_BENCH_SSH, CHUNKYARD_BENCH_SERVICE,
// CHUNKYARD_BENCH_SECONDS (default 20), CHUNKYARD_BENCH_OUTPUT (outside the repository).
// CHUNKYARD_BENCH_FIXTURE=true explicitly creates/removes a shell-only fixture instead.
import { createRequire } from "node:module";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = createRequire(
  new URL("../web/package.json", import.meta.url),
)("playwright");
const run = promisify(execFile);
const base = new URL(
  process.env.CHUNKYARD_BENCH_BASE ?? "https://chunkyard.fractal-tess.xyz",
).origin;
const accountId = process.env.CHUNKYARD_TEST_ACCOUNT_ID;
assert(
  accountId,
  "Set CHUNKYARD_TEST_ACCOUNT_ID to the matching Bitwarden entry ID",
);
const account = JSON.parse(
  execFileSync("bw-agent", ["get", "item", accountId], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
assert(
  account.login.uris.some((u) => new URL(u.uri).origin === base),
  "Credential origin mismatch",
);
const login = await fetch(base + "/api/v1/auth/login", {
  method: "POST",
  headers: {
    Origin: base,
    "X-MCM-CSRF": "1",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: account.login.username,
    password: account.login.password,
  }),
});
assert(login.ok, "Benchmark login failed: " + login.status);
const cookie = login.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
const duration = Math.min(
  60,
  Math.max(10, Number(process.env.CHUNKYARD_BENCH_SECONDS ?? 20)),
);
const output =
  process.env.CHUNKYARD_BENCH_OUTPUT ??
  "/tmp/chunkyard-live-metrics-measurement.json";
const ssh = process.env.CHUNKYARD_BENCH_SSH;
const service = process.env.CHUNKYARD_BENCH_SERVICE;
assert(
  !service || /^[A-Za-z0-9_-]+$/.test(service),
  "Invalid Docker service identifier",
);
async function hostSnapshot() {
  if (!ssh || !service) return null;
  // Reads aggregate process CPU ticks and RSS; does not create a Docker stats subscriber.
  const command = `manager_container=$(sudo -n docker ps --filter label=com.docker.swarm.service.name=${service} --format '{{.ID}}' | head -n 1)
manager_pid=$(sudo -n docker inspect --format '{{.State.Pid}}' "$manager_container")
daemon_pid=$(pidof dockerd)
getconf CLK_TCK
getconf PAGESIZE
sudo -n cat /proc/$manager_pid/stat
sudo -n cat /proc/$daemon_pid/stat`;
  const { stdout } = await run("ssh", ["-o", "BatchMode=yes", ssh, command], {
    timeout: 20000,
    maxBuffer: 65536,
  });
  const [hz, page, manager, daemon] = stdout.trim().split("\n");
  const record = (line) => {
    const fields = line.slice(line.lastIndexOf(")") + 2).split(/\s+/);
    return {
      pid: Number(line.split(" ")[0]),
      ticks: Number(fields[11]) + Number(fields[12]),
      rss: Number(fields[21]) * Number(page),
    };
  };
  return {
    at: performance.now(),
    hz: Number(hz),
    manager: record(manager),
    daemon: record(daemon),
  };
}
let browser;
let context;
let fixture;
async function api(path, method = "GET", data) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: base,
      "X-MCM-CSRF": "1",
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert(response.ok, `Benchmark API ${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function operation(path, method = "POST") {
  const { job } = await api(path, method);
  for (let count = 0; count < 900; count++) {
    const current = await api(`/api/v1/jobs/${job.id}`);
    if (current.state === "succeeded") return current;
    assert(
      !["failed", "cancelled"].includes(current.state),
      `Fixture operation failed: ${current.error?.code}`,
    );
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error("Fixture operation timed out");
}
try {
  const inventory = await (
    await fetch(base + "/api/v1/servers", { headers: { Cookie: cookie } })
  ).json();
  let server = inventory.items.find(
    (s) => !s.archive && s.status.state === "running",
  );
  if (process.env.CHUNKYARD_BENCH_FIXTURE === "true") {
    // This is Bash, not Minecraft. EULA=true is fixture bookkeeping for the generic
    // lifecycle gate; no Minecraft binary, world or network listener is involved.
    fixture = (
      await api("/api/v1/servers", "POST", {
        name: "Temporary metrics benchmark",
        dockerImage: "debian:bookworm-slim",
        acceptEula: true,
        memoryMinMb: 128,
        memoryMaxMb: 128,
        cpus: 0.1,
      })
    ).server;
    await api(`/api/v1/servers/${fixture.id}/network`, "PATCH", {
      port: fixture.port,
      publishIp: "127.0.0.1",
    });
    const script =
      '#!/bin/bash\necho "Temporary Chunkyard metrics test; no Minecraft process"\nwhile IFS= read -r line; do [[ "$line" == stop ]] && exit 0; done\n';
    const upload = await fetch(
      base +
        `/api/v1/servers/${fixture.id}/files/upload?path=metrics-fixture.sh&overwrite=false`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          "X-MCM-CSRF": "1",
          "Content-Type": "application/octet-stream",
        },
        body: script,
      },
    );
    assert(upload.ok, "Fixture upload failed: " + upload.status);
    await api(`/api/v1/servers/${fixture.id}/launch`, "PATCH", {
      profile: {
        mode: "script",
        path: "metrics-fixture.sh",
        javaMajor: 21,
        jvmArgs: [],
        args: [],
      },
    });
    await operation(`/api/v1/servers/${fixture.id}/start`);
    server = await api(`/api/v1/servers/${fixture.id}`);
  }
  assert(
    server,
    "A running local server is needed; this script will not start one",
  );
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      "/run/current-system/sw/bin/google-chrome-stable",
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addCookies(
    cookie.split("; ").map((pair) => {
      const i = pair.indexOf("=");
      return {
        name: pair.slice(0, i),
        value: pair.slice(i + 1),
        url: base,
        httpOnly: true,
        secure: base.startsWith("https:"),
        sameSite: "Lax",
      };
    }),
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  let bytes = 0,
    frames = 0,
    rest = 0;
  let sampleTimes = [];
  const sockets = new Map();
  cdp.on("Network.webSocketCreated", (event) =>
    sockets.set(event.requestId, event.url),
  );
  cdp.on("Network.webSocketFrameReceived", (event) => {
    if (!(sockets.get(event.requestId) ?? "").includes("/metrics/stream"))
      return;
    bytes += Buffer.byteLength(event.response.payloadData);
    frames++;
    try {
      const body = JSON.parse(event.response.payloadData);
      if (body.type === "sample")
        sampleTimes.push(Date.parse(body.sample.sampledAt));
    } catch {}
  });
  page.on("request", (request) => {
    if (/\/metrics(?:\?|$)/.test(new URL(request.url()).pathname)) rest++;
  });
  const perf = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const results = [];
  await page.goto(base + "/servers");
  for (const intervalMs of [0, 1000, 100]) {
    await page.evaluate(
      (ms) => localStorage.setItem("chunkyard.metrics.intervalMs", String(ms)),
      intervalMs,
    );
    await page.goto(base + `/servers/${server.id}`);
    await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
    // Warm startup requests/layout before measuring steady-state work.
    await page.waitForTimeout(2500);
    frames = 0;
    bytes = 0;
    rest = 0;
    sampleTimes = [];
    const hostBefore = await hostSnapshot(),
      before = await perf(),
      start = performance.now();
    await page.waitForTimeout(duration * 1000);
    const after = await perf(),
      hostAfter = await hostSnapshot(),
      elapsed = (performance.now() - start) / 1000;
    const delta = (key) => (after[key] ?? 0) - (before[key] ?? 0);
    // CDP's observation excludes the SSH snapshot time included in the frame window.
    const browserSeconds = delta("Timestamp") || elapsed;
    const hostCpu = (kind) => {
      if (!hostBefore || !hostAfter) return null;
      assert.equal(
        hostBefore[kind].pid,
        hostAfter[kind].pid,
        "Process restarted during benchmark",
      );
      return (
        ((hostAfter[kind].ticks - hostBefore[kind].ticks) /
          hostAfter.hz /
          ((hostAfter.at - hostBefore.at) / 1000)) *
        100
      );
    };
    if (intervalMs > 0) {
      assert(
        sampleTimes.length >= 3,
        "No sustained native metrics stream reached the browser",
      );
      assert.equal(rest, 0, "Live transport unexpectedly fell back to REST");
    }
    const times = [...new Set(sampleTimes)].sort((a, b) => a - b),
      gaps = times
        .slice(1)
        .map((t, i) => t - times[i])
        .sort((a, b) => a - b);
    results.push({
      intervalMs,
      seconds: elapsed,
      browserObservationSeconds: browserSeconds,
      frames,
      bytes,
      bytesPerSecond: bytes / elapsed,
      restMetricsRequests: rest,
      freshSamples: times.length,
      medianNativeSampleMs: gaps.length
        ? gaps[Math.floor(gaps.length / 2)]
        : null,
      browserTaskCpuPercent: (delta("TaskDuration") / browserSeconds) * 100,
      browserScriptCpuPercent: (delta("ScriptDuration") / browserSeconds) * 100,
      browserLayoutMs: delta("LayoutDuration") * 1000,
      jsHeapBytes: after.JSHeapUsedSize,
      managerCpuPercent: hostCpu("manager"),
      dockerDaemonCpuPercent: hostCpu("daemon"),
      managerRssBytes: hostAfter?.manager.rss ?? null,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        base,
        notes:
          "One owned Chrome viewer; existing workloads and other viewers were left untouched. CPU percentages are of one logical core; Docker controls fresh sample cadence. These short samples are observations, not a capacity guarantee.",
        temporaryShellFixture: Boolean(fixture),
        results,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log("Measurement saved: " + output);
} finally {
  await browser?.close();
  if (fixture) {
    const current = await api(`/api/v1/servers/${fixture.id}`);
    assert.equal(current.name, "Temporary metrics benchmark");
    assert.equal(current.dockerImage, "debian:bookworm-slim");
    if (current.status.state === "running")
      await operation(`/api/v1/servers/${fixture.id}/stop`);
    await operation(`/api/v1/servers/${fixture.id}?deleteFiles=true`, "DELETE");
  }
  await fetch(base + "/api/v1/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, Origin: base, "X-MCM-CSRF": "1" },
  });
}
