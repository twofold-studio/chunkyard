// Real Vanilla download and archive progress, optionally verified against the existing RustFS.
// Disposable manager data only. Never accepts the EULA or starts a game container.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const directory=await mkdtemp(resolve(tmpdir(),'chunkyard-progress-'));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`;
const daemon=spawn(resolve('target/debug/mcm'),['--data-dir',directory,'serve','--listen',`127.0.0.1:${port}`],{
  env:{...process.env,CHUNKYARD_AUTH__ENABLED:'false',CHUNKYARD_HTTP__PUBLIC_URL:base,CHUNKYARD_DOCKER__ENABLED:'true',CHUNKYARD_HTTP__UI_DIR:resolve('web/build')},stdio:'ignore',
});
const exited=new Promise(r=>daemon.once('exit',r));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const archives=[];
let browser;let page;
const browserErrors=[];const gameMutations=[];
async function api(path,body,method=body?'POST':'GET'){
  const response=await fetch(base+'/api/v1'+path,{method,headers:{Origin:base,'X-MCM-CSRF':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert(response.ok,`${method} ${path}: ${response.status}`);
  return response.status===204?null:response.json();
}
async function waitJob(job){
  const observed=new Set();
  for(let i=0;i<2400;i++){
    job=await api('/jobs/'+job.id);
    if(job.work?.stage)observed.add(job.work.stage);
    if(['failed','cancelled'].includes(job.state))throw new Error(job.error?.detail??'Job failed');
    if(job.state==='succeeded')return {job,observed};
    assert.equal(job.progress,null,'No invented overall percentage');
    await pause(150);
  }
  throw new Error('Job timed out');
}
try{
  let ready=false;for(let i=0;i<200;i++){assert.equal(daemon.exitCode,null);try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await pause(50);}
  assert(ready);
  if(process.env.CHUNKYARD_TEST_SCREENSHOTS==='1'){
    const require=createRequire(new URL('../web/package.json',import.meta.url));
    browser=await require('playwright').chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
    page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
    page.on('pageerror',error=>browserErrors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST'&&/\/servers\/[^/]+\/(start|stop|restart|kill|eula|install)$/.test(new URL(request.url()).pathname))gameMutations.push(new URL(request.url()).pathname);});
  }
  const {server}=await api('/servers',{name:'Disposable progress verification',software:{type:'vanilla',version:'1.21.4'}});
  const installed=await waitJob((await api('/servers/'+server.id+'/install',{})).job);
  assert(installed.job.work.completedStages.includes('download'));
  assert(installed.job.work.completedStages.includes('verify'));
  assert.equal(installed.job.work.stage,'finalize');
  assert.equal(installed.job.result.server.acceptEula,false);
  assert.equal(installed.job.result.server.status.state,'stopped');
  if(page){
    await page.goto(base+'/activity/'+installed.job.id);await page.getByTestId('work-history').waitFor();
    await page.screenshot({path:'/tmp/chunkyard-integrated-install-progress.png'});
  }
  await api(`/servers/${server.id}/files/mkdir`,{path:'world'});
  await api(`/servers/${server.id}/files/mkdir`,{path:'world/region'});
  const fixture=randomBytes(32*1024*1024);
  const fixtureHash=createHash('sha256').update(fixture).digest('hex');
  const upload=await fetch(base+`/api/v1/servers/${server.id}/files/upload?path=world%2Fregion%2Ftrial.mca`,{
    method:'POST',headers:{Origin:base,'X-MCM-CSRF':'1','Content-Type':'application/octet-stream'},body:fixture,
  });assert(upload.ok,'Fixture upload');
  const destination=process.env.CHUNKYARD_TEST_S3==='1'?'s3':'local';
  if(destination==='s3'){
    const account=JSON.parse(execFileSync('bw-agent',['get','item','c22245a5-eadc-4386-a885-b5020022f9a0'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    assert(account.login.uris.some(u=>u.uri==='http://vd.netbird.cloud:9000'),'Unexpected credential origin');
    await api('/storage',{endpoint:'http://vd.netbird.cloud:9000',region:'us-east-1',bucket:'chunkyard',prefix:'archives',accessKeyId:account.login.username,secretAccessKey:account.login.password},'PUT');
    await api('/storage/test',{});
  }
  const exportJob=(await api(`/servers/${server.id}/exports`,{scope:'all',destination})).job;
  if(page){
    await page.goto(base+'/activity/'+exportJob.id);await page.getByTestId('work-progress').waitFor();
    await page.getByTestId('work-bytes').waitFor();
    await page.screenshot({path:'/tmp/chunkyard-integrated-export-progress.png'});
  }
  const exported=await waitJob(exportJob);
  archives.push(exported.job.result.id);
  const stages=exported.job.work.completedStages;
  assert(stages.includes('scan')&&stages.includes('compress'));
  if(destination==='s3')assert(stages.includes('upload')&&stages.includes('verify_upload'));
  assert.equal(exported.job.work.stage,'finalize');
  let restored=false;
  if(destination==='s3'){
    const exportId=exported.job.result.id;
    let archiveJob;
    if(page){
      await page.goto(base+`/servers/${server.id}?tab=exports`);
      await page.getByRole('button',{name:'Remove local files…',exact:true}).click();
      const dialog=page.getByRole('alertdialog');
      assert(await dialog.getByRole('button',{name:'Remove local files',exact:true}).isDisabled());
      await page.screenshot({path:'/tmp/chunkyard-integrated-remove-local.png'});
      await dialog.getByRole('checkbox').check();
      const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/servers/${server.id}/archive`));
      await dialog.getByRole('button',{name:'Remove local files',exact:true}).click();
      const response=await accepted;assert.equal(response.status(),202);archiveJob=(await response.json()).job;
    }else archiveJob=(await api(`/servers/${server.id}/archive`,{exportId,confirmDiscardChanges:true})).job;
    const archived=await waitJob(archiveJob);
    assert.equal(archived.job.result.server.archive.exportId,exportId);
    assert.equal((await api('/servers')).items[0].id,server.id);
    await assert.rejects(access(resolve(directory,'servers',server.id)));
    const pinned=await fetch(base+'/api/v1/exports/'+exportId,{method:'DELETE',headers:{Origin:base,'X-MCM-CSRF':'1'}});
    assert.equal(pinned.status,409);
    let restoreJob;
    if(page){
      await page.goto(base+'/servers');
      await page.getByTestId('server-card').filter({hasText:server.name}).getByText('Archived',{exact:true}).waitFor();
      await page.screenshot({path:'/tmp/chunkyard-integrated-archived-cards.png'});
      await page.setViewportSize({width:420,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Archived cards overflow on mobile');
      await page.screenshot({path:'/tmp/chunkyard-integrated-archived-mobile.png'});
      await page.setViewportSize({width:1440,height:1050});
      const localRequests=[];
      const inspect=request=>{if(new RegExp(`/servers/${server.id}/(metrics|files|properties|console|network|launch)(/|\\?|$)`).test(request.url()))localRequests.push(request.url());};
      page.on('request',inspect);
      await page.goto(base+`/servers/${server.id}?tab=files`);
      await page.getByRole('region',{name:'Archived server',exact:true}).waitFor();
      assert.equal(await page.getByRole('tab',{name:'Files',exact:true}).count(),0);
      await page.screenshot({path:'/tmp/chunkyard-integrated-archived-detail.png'});
      assert.deepEqual(localRequests,[],'Archived page must not request local runtime/files/configuration');
      page.off('request',inspect);
      await page.goto(base+'/exports');
      await page.getByRole('button',{name:`Restore ${server.name}`,exact:true}).waitFor();
      await page.screenshot({path:'/tmp/chunkyard-integrated-backup-servers.png'});
      await page.getByRole('button',{name:`Restore ${server.name}`,exact:true}).click();
      const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/exports/${exportId}/restore`));
      await page.getByRole('alertdialog').getByRole('button',{name:'Restore',exact:true}).click();
      const response=await accepted;assert.equal(response.status(),202);restoreJob=(await response.json()).job;
    }else restoreJob=(await api(`/exports/${exportId}/restore`,{})).job;
    const result=await waitJob(restoreJob);
    assert.equal(result.job.result.server.id,server.id);assert.equal(result.job.result.server.archive,null);
    assert.equal(result.job.result.server.acceptEula,false);assert.equal(result.job.result.server.status.state,'stopped');
    assert.equal(result.job.result.server.launch.checksum,installed.job.result.server.launch.checksum);
    const download=await fetch(base+`/api/v1/servers/${server.id}/files/download?path=world%2Fregion%2Ftrial.mca`);
    assert(download.ok);assert.equal(createHash('sha256').update(new Uint8Array(await download.arrayBuffer())).digest('hex'),fixtureHash);
    restored=true;
    if(page){
      await page.goto(base+'/servers');
      await page.getByTestId('server-card').filter({hasText:server.name}).getByText('Stopped',{exact:true}).waitFor();
      await page.screenshot({path:'/tmp/chunkyard-integrated-restored-cards.png'});
      assert.deepEqual(gameMutations,[],'UI never starts/stops/installs/accepts EULA implicitly');
      assert.deepEqual(browserErrors,[],'Browser runtime errors');
    }
  }
  console.log(JSON.stringify({installStages:installed.job.work.completedStages,installObserved:[...installed.observed],exportStages:stages,exportObserved:[...exported.observed],destination,bytes:exported.job.result.size,restoredSameIdentity:restored,noGameStarted:true}));
}finally{
  await browser?.close();
  let cleaned=true;
  try{for(const server of (await api('/servers')).items){if(archives.includes(server.archive?.exportId))await waitJob((await api('/exports/'+server.archive.exportId+'/restore',{})).job);}}catch{cleaned=false;}
  for(const id of archives){try{await api('/exports/'+id,null,'DELETE');}catch{cleaned=false;console.error('Disposable archive cleanup needs retry:',id);}}
  daemon.kill('SIGTERM');await exited;
  if(cleaned)await rm(directory,{recursive:true,force:true});else console.error('Retained disposable manager data for recovery:',directory);
}
