// Explicitly opted-in production check. Installs a disposable pack's loader only;
// never starts Minecraft, accepts its EULA or changes an existing instance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.CHUNKYARD_VERIFY_DEPLOYED !== '1') throw new Error('Set CHUNKYARD_VERIFY_DEPLOYED=1 explicitly.');
const required = name => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const base = required('CHUNKYARD_TEST_BASE_URL');
assert.equal(new URL(base).origin, base);
let cookie = '', instance, activeJob;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { Origin: base, 'X-MCM-CSRF': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (path === '/auth/login') cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function wait(job) {
  activeJob = job.id;
  for (let attempt = 0; attempt < 600; attempt++) {
    const current = await api(`/jobs/${job.id}`);
    if (current.state === 'succeeded' || current.state === 'failed') {
      activeJob = null;
      if (current.state === 'failed') throw new Error(`Job failed: ${current.error?.code}`);
      return current.result;
    }
    if (attempt % 30 === 0) console.log(`Disposable install job: ${current.state}`);
    await new Promise(done => setTimeout(done, 2000));
  }
  throw new Error('Install timeout; leave the fixture until its active job finishes.');
}
try {
  await api('/auth/login', 'POST', { email: required('CHUNKYARD_TEST_EMAIL'), password: required('CHUNKYARD_TEST_PASSWORD') });
  const before = (await api('/servers')).items.map(item => item.id);
  assert((await api('/software')).items.some(item => item.id === 'curseforge' && item.available));
  const search = await api('/modpacks/curseforge?query=RLCraft');
  assert(search.items.some(item => item.id === 285109));
  const release = (await api('/modpacks/curseforge/285109/files')).items[0];
  assert(release?.serverPackFileId);
  instance = (await api('/servers', 'POST', {
    name: `Disposable CurseForge verification ${randomUUID()}`,
    memoryMinMb: 512, memoryMaxMb: 2048, cpus: 1,
    software: { type: 'curseforge', projectId: 285109, fileId: release.id }
  })).server;
  await wait((await api(`/servers/${instance.id}/install`, 'POST')).job);
  const installed = await api(`/servers/${instance.id}`);
  assert.equal(installed.server.acceptEula, false);
  assert(installed.server.launch?.path);
  assert.equal(installed.status.state, 'stopped');
  const launch = await api(`/servers/${instance.id}/launch`);
  assert.equal(launch.overridden, false);
  assert.equal(launch.current.mode, 'jar');
  assert.equal(launch.current.javaMajor, 8);
  const storage = await api('/storage');
  if (storage.configured) assert.equal((await api('/storage/test', 'POST')).ok, true);
  await wait((await api(`/servers/${instance.id}?deleteFiles=true`, 'DELETE')).job);
  instance = null;
  const after = (await api('/servers')).items.map(item => item.id);
  for (const id of before) assert(after.includes(id), 'Existing instances preserved');
  console.log('PASS: deployed CurseForge search/releases, verified Forge loader installation, launch detection, unchanged EULA, RustFS probe and disposable-instance cleanup. Minecraft was not started.');
} finally {
  if (instance && !activeJob) await wait((await api(`/servers/${instance.id}?deleteFiles=true`, 'DELETE')).job);
  if (instance && activeJob) console.error(`Fixture ${instance.id} retained because job ${activeJob} is still active.`);
  if (cookie) await api('/auth/logout', 'POST');
}
