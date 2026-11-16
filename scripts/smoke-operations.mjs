// Real Vanilla + isolated manager + RustFS. Never changes the live manager.
// Requires explicit owner EULA consent: CHUNKYARD_TEST_EULA_ACCEPTED=true.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

assert.equal(process.env.CHUNKYARD_TEST_EULA_ACCEPTED, 'true', 'Explicit disposable-server EULA consent required');
const directory = await mkdtemp('/tmp/chunkyard-operations-');
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`;
const prefix = `chunkyard-release-test-${randomUUID()}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let manager, browser, server, manual, scheduled;
const ownExports = new Set();
async function api(path, method = 'GET', body) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Origin: base, 'X-MCM-CSRF': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function until(check, timeout = 240000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await sleep(1000);
  }
  throw new Error('Timed out waiting for disposable trial');
}
async function job(response) {
  const id = response.job.id;
  return until(async () => {
    const current = await api(`/jobs/${id}`);
    if (current.state === 'failed' || current.state === 'cancelled') throw new Error(`Job ${current.kind}: ${JSON.stringify(current.error)}`);
    return current.state === 'succeeded' && current;
  }, 600000);
}
async function startManager() {
  manager = spawn(resolve(process.env.CHUNKYARD_TEST_BINARY || 'target/debug/mcm'), ['--data-dir', directory, 'serve', '--listen', `127.0.0.1:${port}`], {
    env: { ...process.env, CHUNKYARD_AUTH__ENABLED: 'false', CHUNKYARD_HTTP__PUBLIC_URL: base,
      CHUNKYARD_HTTP__UI_DIR: resolve('web/build'), CHUNKYARD_DOCKER__PUBLISH_IP: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  manager.stderr.resume();
  await until(async () => {
    if (manager.exitCode !== null) throw new Error('Isolated manager exited');
    try { return (await fetch(base + '/healthz')).ok; } catch { return false; }
  }, 30000);
}
async function stopManager() {
  if (!manager || manager.exitCode !== null) return;
  const exited = new Promise(r => manager.once('exit', r));
  manager.kill('SIGTERM');
  await exited;
}
async function worldHashes() {
  const root = join(directory, 'servers', server.id, 'world');
  const hashes = {};
  async function walk(dir, relative = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = relative + entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), name + '/');
      else if (entry.isFile()) hashes[name] = createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex');
      else throw new Error('Unexpected world symlink/special file');
    }
  }
  await walk(root);
  assert(hashes['level.dat'], 'Minecraft must generate a real world');
  assert(Object.keys(hashes).some(p => p.endsWith('.mca')), 'World must contain generated regions');
  return hashes;
}
try {
  await startManager();
  // Credentials go directly from SSH stdout to memory, never stdout or artifacts.
  const storage = JSON.parse(execFileSync('ssh', ['oracle', 'sudo cat /var/lib/docker/volumes/chunkyard-data/_data/exports/storage.json'], { encoding: 'utf8' }));
  storage.prefix = prefix;
  await api('/storage', 'PUT', storage);
  assert((await api('/storage')).configured);
  await api('/storage/test', 'POST');
  server = (await api('/servers', 'POST', { name: 'Disposable release world', memoryMinMb: 512, memoryMaxMb: 1024, cpus: 1,
    acceptEula: true, software: { type: 'vanilla', version: '1.21.1' } })).server;
  const id = server.id;
  await job(await api(`/servers/${id}/install`, 'POST'));
  const properties = await api(`/servers/${id}/properties`);
  await api(`/servers/${id}/properties`, 'PUT', { etag: properties.etag,
    content: properties.content + '\nview-distance=2\nsimulation-distance=2\n' });
  await api(`/servers/${id}/backup-schedule`, 'PUT', { enabled: true, intervalMinutes: 1, keepLast: 1, confirmRetentionDeletion: true });
  await job(await api(`/servers/${id}/start`, 'POST'));
  const ready = await until(async () => {
    const status = await api(`/servers/${id}/status`);
    return status.state === 'ready' && status;
  });
  assert.equal(ready.onlinePlayers, 0);
  console.log('Vanilla generated world and answered real Server List Ping.');
  const uuid = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
  for (const [list, action] of [['whitelist', 'add'], ['operators', 'add'], ['bans', 'add'], ['bans', 'remove'], ['operators', 'remove'], ['whitelist', 'remove']]) {
    await job(await api(`/servers/${id}/players`, 'POST', { list, action, name: 'Notch', uuid }));
  }
  console.log('Running Minecraft confirmed whitelist/operator/ban additions and removals.');
  await until(async () => (await api(`/servers/${id}/automation`)).lastBackupResult === 'skipped_running', 120000);
  const history = await api(`/servers/${id}/metrics/history?hours=1`);
  assert(history.items.length > 0, 'Background history must collect without a browser');
  const { chromium } = createRequire(new URL('../web/package.json', import.meta.url))('playwright');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/run/current-system/sw/bin/google-chrome-stable' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${base}/servers/${id}`);
  await page.getByText('Minecraft answered a Server List Ping.', { exact: false }).first().waitFor();
  await page.screenshot({ path: '/tmp/chunkyard-refactor-overview.png', fullPage: true });
  await page.getByRole('button', { name: '1h', exact: true }).click();
  await page.getByTestId('stored-history-note').waitFor();
  await page.screenshot({ path: '/tmp/chunkyard-refactor-history.png', fullPage: true });
  await page.getByRole('tab', { name: 'Players', exact: true }).click();
  await page.getByRole('tab', { name: /^Whitelist/ }).waitFor();
  await page.screenshot({ path: '/tmp/chunkyard-refactor-players.png', fullPage: true });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByText('Crash recovery', { exact: false }).first().waitFor();
  await page.screenshot({ path: '/tmp/chunkyard-refactor-settings.png', fullPage: true });
  assert.deepEqual(pageErrors, [], 'Real UI must not report JavaScript errors');
  await browser.close(); browser = null;
  await job(await api(`/servers/${id}/stop`, 'POST'));
  const before = await worldHashes();
  manual = (await job(await api(`/servers/${id}/exports`, 'POST', { scope: 'all', paths: [], destination: 's3' }))).result;
  manual = manual.export || manual;
  ownExports.add(manual.id);
  console.log(`Verified manual full S3 backup; ${Object.keys(before).length} real world files hashed.`);
  await until(async () => {
    const state = await api(`/servers/${id}/automation`);
    if (state.lastBackupResult !== 'succeeded') return false;
    scheduled = state.lastBackupExportId; ownExports.add(scheduled); return true;
  }, 120000);
  const first = scheduled;
  await until(async () => {
    const state = await api(`/servers/${id}/automation`);
    if (state.lastBackupExportId === first || state.lastBackupResult !== 'succeeded') return false;
    scheduled = state.lastBackupExportId; ownExports.add(scheduled);
    return !(await api('/exports')).items.some(x => x.id === first);
  }, 120000);
  assert((await api('/exports')).items.some(x => x.id === manual.id), 'Retention must keep manual backups');
  await api(`/servers/${id}/backup-schedule`, 'PUT', { enabled: false, intervalMinutes: 1, keepLast: 1 });
  console.log('Two real scheduled RustFS backups verified; retention preserved manual backup.');
  await job(await api(`/servers/${id}/archive`, 'POST', { exportId: manual.id, confirmDiscardChanges: true }));
  assert((await api(`/servers/${id}`)).archive);
  await job(await api(`/exports/${manual.id}/restore`, 'POST'));
  assert.deepEqual(await worldHashes(), before, 'Every world-file checksum must survive S3 archive/restore');
  await job(await api(`/servers/${id}/start`, 'POST'));
  await until(async () => (await api(`/servers/${id}/status`)).state === 'ready');
  await job(await api(`/servers/${id}/stop`, 'POST'));
  console.log('Restored world matches every SHA-256 and Minecraft loaded it successfully.');
  await api(`/servers/${id}/recovery`, 'PUT', { autoStart: true, restartOnCrash: true, maxAttempts: 2, retryDelaySeconds: 5 });
  await stopManager();
  await startManager();
  await until(async () => (await api(`/servers/${id}/status`)).state === 'ready');
  const running = await api(`/servers/${id}`);
  assert(running.status.containerId, 'Owned fixture container must be identified before killing it');
  execFileSync('docker', ['kill', running.status.containerId], { stdio: 'pipe' });
  await until(async () => (await api(`/servers/${id}/automation`)).restartAttempts === 2);
  await until(async () => (await api(`/servers/${id}/status`)).state === 'ready');
  await job(await api(`/servers/${id}/stop`, 'POST'));
  assert.equal((await api(`/servers/${id}/automation`)).desiredRunning, false);
  console.log('Opt-in startup and real crash recovery succeeded; manual Stop cleared recovery intent.');
} finally {
  if (browser) await browser.close();
  let cleaned = false;
  try {
    if (server && manager?.exitCode === null) {
      const id = server.id;
      // All listed objects belong to this isolated manager and unique test prefix.
      let view = await api(`/servers/${id}`);
      if (view.archive) {
        await job(await api(`/exports/${manual.id}/restore`, 'POST'));
        view = await api(`/servers/${id}`);
      }
      if (view.status.state === 'running') await job(await api(`/servers/${id}/stop`, 'POST'));
      await job(await api(`/servers/${id}`, 'DELETE'));
      for (const archive of (await api('/exports')).items) await api(`/exports/${archive.id}`, 'DELETE');
    }
    cleaned = true;
  } finally {
    await stopManager();
    if (cleaned) {
      await rm(directory, { recursive: true });
      console.log('Removed own disposable instance, test archives and isolated credentials/data.');
    } else console.error(`Cleanup incomplete; isolated evidence retained at ${directory}`);
  }
}
