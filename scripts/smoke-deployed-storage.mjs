// Explicit opt-in: configure the deployed app's RustFS connection and exercise only a
// disposable instance/archive. Never starts a game or modifies an existing instance.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
if (process.env.CHUNKYARD_VERIFY_DEPLOYED !== '1') throw new Error('Set CHUNKYARD_VERIFY_DEPLOYED=1 explicitly.');
const required = name => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const base = required('CHUNKYARD_TEST_BASE_URL');
assert.equal(new URL(base).origin, base);
const email = required('CHUNKYARD_TEST_EMAIL'), password = required('CHUNKYARD_TEST_PASSWORD');
const endpoint = required('CHUNKYARD_TEST_S3_ENDPOINT');
const accessKeyId = required('CHUNKYARD_TEST_S3_ACCESS_KEY');
const secretAccessKey = required('CHUNKYARD_TEST_S3_SECRET_KEY');
let cookie = '', instance, archive;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {method, redirect:'error', headers:{Origin:base,'X-MCM-CSRF':'1',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})}, ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if (path === '/api/v1/auth/login') cookie = response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}`);
  return response.status===204 ? null : response.json();
}
async function wait(job) {
  for(let attempt=0;attempt<180;attempt++) {
    const current = await api(`/api/v1/jobs/${job.id}`);
    if(current.state==='succeeded') return current.result;
    if(current.state==='failed') throw new Error(`Job failed: ${current.error?.code}`);
    await new Promise(done=>setTimeout(done,500));
  }
  throw new Error('Verification job timeout');
}
try {
  await api('/api/v1/auth/login','POST',{email,password});
  const before = (await api('/api/v1/servers')).items.map(s=>s.id);
  const connection = await api('/api/v1/storage');
  if(connection.configured) {
    assert.equal(connection.endpoint,endpoint,'Preserve an existing different connection');
    assert.equal(connection.bucket,'chunkyard');
    assert.equal(connection.accessKeyId,accessKeyId);
  } else {
    const saved = await api('/api/v1/storage','PUT',{endpoint,accessKeyId,secretAccessKey,region:'us-east-1',bucket:'chunkyard',prefix:'archives'});
    assert.equal(saved.hasSecret,true);assert.equal(saved.secretAccessKey,undefined);
  }
  assert.equal((await api('/api/v1/storage/test','POST')).ok,true);
  const name=`Storage verification ${randomUUID()}`;
  instance=(await api('/api/v1/servers','POST',{name,memoryMinMb:128,memoryMaxMb:256,cpus:0.1})).server;
  await api(`/api/v1/servers/${instance.id}/files/content?path=verification.txt`,'PUT',{content:'chunkyard-storage-verification\n',etag:null});
  archive=await wait((await api(`/api/v1/servers/${instance.id}/exports`,'POST',{scope:'all',destination:'s3'})).job);
  await wait((await api(`/api/v1/servers/${instance.id}?deleteFiles=true`,'DELETE')).job);
  instance=null;
  const listing = await api('/api/v1/exports');
  assert(listing.items.some(e=>e.id===archive.id),'Archive survives instance deletion');
  const download=await fetch(`${base}/api/v1/exports/${archive.id}/download`,{headers:{Cookie:cookie,Origin:base},redirect:'error'});
  assert.equal(download.status,200);
  const bytes=Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.length,archive.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),archive.sha256);
  assert(gunzipSync(bytes).includes(Buffer.from('chunkyard-storage-verification')));
  await api(`/api/v1/exports/${archive.id}`,'DELETE');archive=null;
  const after=(await api('/api/v1/servers')).items.map(s=>s.id);
  for(const id of before) assert(after.includes(id),'Existing instances preserved');
  console.log('PASS: deployed RustFS connection, verified S3 export, original fixture deletion, authenticated archive download and cleanup; existing instances preserved.');
} finally {
  if(instance) await wait((await api(`/api/v1/servers/${instance.id}?deleteFiles=true`,'DELETE')).job);
  if(archive) await api(`/api/v1/exports/${archive.id}`,'DELETE');
  if(cookie) await api('/api/v1/auth/logout','POST');
}
