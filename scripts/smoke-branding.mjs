// Real backend + built SPA, real read-only CurseForge metadata. Never installs or starts a game.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright');
assert(process.env.CHUNKYARD_TEST_CURSEFORGE_KEY, 'A private test CurseForge credential is required');
const directory = await mkdtemp(resolve(tmpdir(), 'chunkyard-branding-'));
const socket = createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(resolve('target/debug/mcm'), ['--data-dir',directory,'serve','--listen',`127.0.0.1:${port}`], {
  env:{...process.env,CHUNKYARD_AUTH__ENABLED:'false',CHUNKYARD_HTTP__PUBLIC_URL:base,
    CHUNKYARD_HTTP__UI_DIR:resolve('web/build'),CHUNKYARD_DOCKER__ENABLED:'true',
    CHUNKYARD_CURSEFORGE__API_KEY:process.env.CHUNKYARD_TEST_CURSEFORGE_KEY},
  stdio:'ignore',
});
const exited = new Promise(r => daemon.once('exit', r));
let browser;
try {
  let ready=false;
  for(let i=0;i<200;i++){
    assert.equal(daemon.exitCode,null,'Temporary manager exited');
    try { if((await fetch(base+'/healthz')).ok){ready=true;break;} }catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  assert(ready,'Temporary manager startup timed out');
  async function api(path,body,method=body?'POST':'GET'){
    const response=await fetch(base+'/api/v1'+path,{method,
      headers:{Origin:base,'X-MCM-CSRF':'1','Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})});
    assert(response.ok,`${method} ${path}: ${response.status}`);
    return response.json();
  }
  const capacity=await api('/system/isolation');
  assert(capacity.docker.available && capacity.docker.capacity.logicalCpus>0);
  const pack=await api('/modpacks/curseforge/925200');
  assert.match(pack.name,/All the Mods 10/i);
  assert.equal(pack.logoUrl,'/api/v1/modpacks/curseforge/925200/logo');
  const logo=await fetch(base+pack.logoUrl);
  assert.equal(logo.status,200);
  assert.equal(logo.headers.get('content-type'),'image/png');
  const bytes=new Uint8Array(await logo.arrayBuffer());
  assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
  const {server}=await api('/servers',{name:'ATM 10',software:{type:'curseforge',projectId:925200,fileId:9431424},memoryMaxMb:8048});
  assert.equal(server.acceptEula,false);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/servers/new');
  await page.getByText('CurseForge modpack',{exact:true}).click();
  const select=page.getByRole('button',{name:'Select All the Mods 10 - ATM10',exact:true});
  await select.waitFor({timeout:60000});
  await page.waitForFunction(()=>[...document.images].filter(i=>i.currentSrc.includes('/logo')&&i.complete&&i.naturalWidth>0).length>=6,{},{timeout:60000});
  const overflow=()=>document.documentElement.scrollWidth>innerWidth+1;
  assert.equal(await page.evaluate(overflow),false,'Desktop horizontal overflow');
  await page.screenshot({path:'/tmp/chunkyard-integrated-modpacks.png'});
  await page.setViewportSize({width:420,height:900});
  assert.equal(await page.evaluate(overflow),false,'Mobile horizontal overflow');
  await page.screenshot({path:'/tmp/chunkyard-integrated-modpacks-mobile.png'});
  await page.setViewportSize({width:1440,height:1050});
  await select.click();
  await page.getByRole('radio').first().waitFor({timeout:60000});
  await page.screenshot({path:'/tmp/chunkyard-integrated-releases.png'});
  await page.getByRole('radio').first().locator('..').click();
  await page.getByLabel('Server name',{exact:true}).fill('My modded server');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByRole('button',{name:'8 GB',exact:true}).click();
  await page.getByText(/^Docker host:/).first().waitFor();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="8 GB"]')?.getAttribute('aria-pressed')==='true');
  await page.screenshot({path:'/tmp/chunkyard-integrated-resources.png'});
  await page.goto(base+'/servers/'+server.id+'?tab=overview');
  await page.getByRole('link',{name:/All the Mods 10/i}).first().waitFor({timeout:60000});
  await page.screenshot({path:'/tmp/chunkyard-integrated-overview.png'});
  await page.goto(base+'/servers/'+server.id+'?tab=settings');
  await page.getByText('Resources',{exact:true}).locator('..').getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await page.getByLabel('Server RAM (MiB)',{exact:true}).inputValue(),'8048');
  const uploaded=await fetch(base+`/api/v1/servers/${server.id}/icon`,{method:'PUT',headers:{Origin:base,'X-MCM-CSRF':'1','Content-Type':'image/png'},body:bytes});
  assert.equal(uploaded.status,200);
  assert.equal((await uploaded.json()).server.icon.source,'custom');
  assert.equal((await api('/servers/'+server.id)).icon.source,'custom');
  assert.deepEqual(errors,[],'Browser runtime errors');
  assert.equal((await api('/servers')).items.length,1,'Wizard screenshot never creates a server');
  console.log('Real metadata/logos, host capacity, wizard selection, exact heap preservation, custom icon and screenshots passed; no game was installed or started.');
}finally{
  await browser?.close();
  daemon.kill('SIGTERM');
  await exited;
  await rm(directory,{recursive:true,force:true});
}
