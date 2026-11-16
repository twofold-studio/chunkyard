// Disposable real-provider/Docker checks. Never accepts the EULA or starts Minecraft.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const directory = await mkdtemp('/tmp/chunkyard-software-');
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`;
const ids = [];
let finish;
const hold = new Promise(r => { finish = r; });
process.on('SIGTERM', finish);
process.on('SIGINT', finish);
const manager = spawn(resolve('target/debug/mcm'), ['--data-dir', directory, 'serve', '--listen', `127.0.0.1:${port}`], {
  env: { ...process.env, CHUNKYARD_AUTH__ENABLED: 'false', CHUNKYARD_HTTP__PUBLIC_URL: base,
    CHUNKYARD_HTTP__UI_DIR: resolve('web/build'), CHUNKYARD_DOCKER__PUBLISH_IP: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
manager.stderr.resume();
console.log('Disposable trial:', JSON.stringify({ base, directory, pid: process.pid }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(check, timeout = 600000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(1000);
  }
  throw new Error('Disposable software trial timed out');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { Origin: base, 'X-MCM-CSRF': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function job(response, expectFailure = false) {
  return until(async () => {
    const result = await api(`/jobs/${response.job.id}`);
    if (!['failed', 'succeeded', 'cancelled'].includes(result.state)) return false;
    if (!expectFailure) assert.equal(result.state, 'succeeded', JSON.stringify(result.error));
    return result;
  });
}
try {
  await until(async () => {
    assert.equal(manager.exitCode, null, 'Disposable manager exited');
    try { return (await fetch(base + '/healthz')).ok; } catch { return false; }
  }, 30000);
  if (process.env.CHUNKYARD_TEST_STORAGE === 'true') {
    // Copy only into this isolated fixture; keep secrets in memory and private app storage.
    const storage = JSON.parse(execFileSync('ssh', ['oracle', 'sudo cat /var/lib/docker/volumes/chunkyard-data/_data/exports/storage.json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
    storage.prefix = `chunkyard-software-test-${randomUUID()}`;
    await api('/storage', 'PUT', storage);
  }
  const catalog = (await api('/software')).items;
  const uiOnly = process.env.CHUNKYARD_TEST_UI_ONLY === 'true';
  if (uiOnly) {
    const created = (await api('/servers', 'POST', { name: 'Backup preview' })).server;
    ids.push(created.id);
    console.log(`UI-only stopped instance: ${created.id}`);
  }
  for (const kind of uiOnly ? [] : ['fabric', 'forge', 'neoforge', 'purpur']) {
    assert(catalog.some(item => item.id === kind && item.available));
    const version = '1.21.1';
    const versions = await api(`/software/${kind}/versions`);
    assert(versions.items.some(item => item.id === version), `${kind} game catalog`);
    const builds = await api(`/software/${kind}/versions/${version}/builds`);
    const build = builds.items.find(item => item.stable)?.id;
    assert(build, `${kind} must offer a stable compatible loader/build`);
    const software = kind === 'purpur' ? { type: kind, version, build } : { type: kind, version, loaderVersion: build };
    const created = (await api('/servers', 'POST', { name: `${kind} trial`, software, memoryMinMb: 512, memoryMaxMb: 1024, cpus: 1 })).server;
    ids.push(created.id);
    console.log(`${kind}: installing Minecraft ${version}, build/loader ${build}; instance ${created.id}`);
    const completed = await job(await api(`/servers/${created.id}/install`, 'POST'));
    const installed = completed.result.server;
    assert.equal(installed.acceptEula, false);
    assert.equal(installed.status.state, 'stopped');
    assert.equal(installed.launch.version, version);
    assert.match(installed.launch.checksum, /^[a-f0-9]{64}$/);
    assert((await stat(join(directory, 'servers', created.id, installed.launch.path))).isFile());
    if (kind !== 'purpur') {
      assert.equal(installed.launch.loader.type, kind);
      assert.equal(installed.launch.loader.version, build);
    }
    const refused = await job(await api(`/servers/${created.id}/start`, 'POST'), true);
    assert.equal(refused.state, 'failed');
    assert.equal(refused.error.code, 'server.eula_required');
    console.log(`${kind}: real verified download, Docker preparation and persisted launch passed; Start requires EULA.`);
  }
  if (process.env.CHUNKYARD_TEST_HOLD === 'true') {
    console.log('Ready for real UI checks; SIGTERM this script to clean up.');
    await hold;
  }
} finally {
  let cleaned = false;
  try {
    for (const id of ids) {
      const view = await api(`/servers/${id}`);
      if (view.status.state === 'running') await job(await api(`/servers/${id}/stop`, 'POST'));
      await job(await api(`/servers/${id}?deleteFiles=true`, 'DELETE'));
    }
    cleaned = true;
  } finally {
    if (manager.exitCode === null) {
      const done = new Promise(r => manager.once('exit', r));
      manager.kill('SIGTERM');
      await done;
    }
    if (cleaned) {
      await rm(directory, { recursive: true });
      console.log('Removed own trial instances, containers and private test data.');
    } else console.error(`Cleanup incomplete; own trial evidence retained at ${directory}`);
  }
}
