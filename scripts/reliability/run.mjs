import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { encryptBackup, decryptBackup } from '../../deploy/backup-crypto.mjs';

const root=resolve('docker-test-results/reliability-20261016'),evidence=resolve(root,'evidence');
const base=['compose','--env-file','docker-test-results/reliability-20261016/compose.env','-f','deploy/compose.reliability.yaml'];
const output=(file,value)=>writeFileSync(resolve(evidence,file+'.json'),JSON.stringify(value,null,2));
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe']});
const compose=args=>docker([...base,...args]);
async function command(args,label){
  const start=performance.now(),child=spawn('docker',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b;process.stdout.write(b);});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  writeFileSync(resolve(evidence,label+'.log'),log);
  assert.equal(code,0,`${label} failed; see suppressed-safe log`);return {elapsedMs:performance.now()-start};
}
function isolated(){
  const pg=JSON.parse(docker(['inspect','td-reliability-20261016-postgres-1']))[0];
  assert.equal(pg.Config.Labels['com.docker.compose.project'],'td-reliability-20261016');
  const net=JSON.parse(docker(['network','inspect','td-reliability-20261016_sandbox']))[0];assert(net.Internal);
  const volume=pg.Mounts.find(m=>m.Destination==='/var/lib/postgresql/data');assert.equal(volume.Name,'td-reliability-20261016_reliability_pg');
  output('isolation',{project:pg.Config.Labels['com.docker.compose.project'],networkInternal:net.Internal,volume:volume.Name,existingDataReset:false,
    productionCredentialsRead:false,hostPort:'127.0.0.1:9443',isolatedAt:new Date().toISOString()});
}
async function crash(){
  compose(['run','-d','--name','td-reliability-crash-client','--no-deps','tools','scripts/reliability/check.ts','restart']);
  for(let i=0;!existsSync(resolve(evidence,'restart-pending.json'));i++){assert(i<100);await delay(100);}
  const started=performance.now();compose(['kill','--signal','SIGKILL','app']);
  await command([...base,'start','app'],'restart-start');
  for(let i=0;i<100;i++){const status=JSON.parse(docker(['inspect','td-reliability-20261016-app-1']))[0].State;
    if(status.Health?.Status==='healthy')break;assert(i<99);await delay(250);}
  await command([...base,'run','--rm','--no-deps','tools','scripts/reliability/check.ts','expire'],'crash-held-reservation');
  for(let i=1;i<=2;i++)await command([...base,'run','--rm','--no-deps','recovery'],'recovery-'+i);
  await command([...base,'run','--rm','--no-deps','tools','scripts/reliability/check.ts','recovery'],'recovery-verification');
  output('crash-timing',{elapsedMs:performance.now()-started,signal:'SIGKILL',leaseClockAccelerated:true,scope:'ONLY isolated app; original project untouched'});
}
async function load(){
  let sampling=true;const resources=[];
  const sample=async()=>{while(sampling){try{
    const data=docker(['stats','--no-stream','--format','{{json .}}','td-reliability-20261016-app-1','td-reliability-20261016-postgres-1','td-reliability-20261016-redis-1','td-reliability-20261016-caddy-1','td-reliability-20261016-mock-1']);
    resources.push({at:new Date().toISOString(),phase:existsSync(resolve(evidence,'active-phase.json'))?JSON.parse(readFileSync(resolve(evidence,'active-phase.json'),'utf8')):null,
      containers:data.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))});
    if(resources.at(-1).containers.some(row=>parseFloat(row.MemPerc)>=90))output('stop-load',{reason:'container_memory_at_least_90_percent',at:new Date().toISOString()});
    output('resources',resources);
  }catch{resources.push({at:new Date().toISOString(),sampleError:true});}await delay(1500);}};
  const samples=sample();try{await command([...base,'run','--rm','--no-deps','tools','scripts/reliability/check.ts','load'],'load-run');}
  finally{sampling=false;await samples;output('resources',resources);}
}
async function suite(){
  // No production .env, credentials or payment configuration is mounted.
  const focused=process.argv[3]==='streaming';
  await command([...base,'run','--rm','--no-deps','--entrypoint','sh','suite-tools','-c',
    `set -a; . /run/secrets/suite_env; set +a; export NODE_ENV=test; ${focused?'npm run test:streaming':'npm test'}`],focused?'streaming-sdk-final':'full-regression');
}
async function backup(){
  const sql=statement=>compose(['exec','-T','postgres','psql','-U','aihub','-d','aihub_auth_test','-At','-v','ON_ERROR_STOP=1','-c',statement]).trim();
  const marker=randomBytes(16).toString('hex');
  sql('CREATE TABLE IF NOT EXISTS reliability_backup_marker (id text PRIMARY KEY, committed_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  const committed=sql(`INSERT INTO reliability_backup_marker(id) VALUES ('${marker}') RETURNING committed_at`);
  await command([...base,'run','--rm','--no-deps','tools','scripts/reliability/check.ts','snapshot'],'backup-source-snapshot');
  const dumpStart=new Date().toISOString();
  compose(['exec','-T','postgres','pg_dump','-U','aihub','-d','aihub_auth_test','-Fc','-f','/tmp/reliability-audit.dump']);
  const dumpComplete=new Date().toISOString();
  const toc=compose(['exec','-T','postgres','pg_restore','--list','/tmp/reliability-audit.dump']);assert(toc.includes('WalletTransaction')&&toc.includes('PaymentOrder'));
  writeFileSync(resolve(evidence,'backup-toc.txt'),toc);
  compose(['exec','-T','postgres','psql','-U','aihub','-d','aihub_auth_test','-v','ON_ERROR_STOP=1','-c',`INSERT INTO reliability_backup_marker(id) VALUES ('after-${marker}')`]);
  const staging=resolve(root,'staging');mkdirSync(staging,{recursive:true});
  const plain=resolve(staging,'source.dump'),cipher=resolve(root,'evidence','database.dump.enc'),key=resolve(root,'secrets','backup.key'),decrypted=resolve(staging,'restored.dump');
  docker(['cp','td-reliability-20261016-postgres-1:/tmp/reliability-audit.dump',plain]);
  const sourceBytes=readFileSync(plain),sourceHash=createHash('sha256').update(sourceBytes).digest('hex');
  writeFileSync(key,randomBytes(32),{mode:0o600,flag:'wx'});
  await encryptBackup(plain,cipher,key);const cipherHash=createHash('sha256').update(readFileSync(cipher)).digest('hex');
  writeFileSync(cipher+'.sha256',cipherHash+'  database.dump.enc\n');
  const corrupt=resolve(staging,'tampered.enc'),corruptOut=resolve(staging,'invalid.dump'),wrongKey=resolve(staging,'wrong.key');
  const damaged=Buffer.from(readFileSync(cipher));damaged[40]^=1;writeFileSync(corrupt,damaged);writeFileSync(wrongKey,randomBytes(32),{mode:0o600});
  await assert.rejects(decryptBackup(corrupt,corruptOut,key));assert(!existsSync(corruptOut));
  await assert.rejects(decryptBackup(cipher,corruptOut,wrongKey));assert(!existsSync(corruptOut));
  const disasterAt=new Date().toISOString(),restoreStart=performance.now();
  await decryptBackup(cipher,decrypted,key);
  assert.equal(createHash('sha256').update(readFileSync(decrypted)).digest('hex'),sourceHash);
  docker(['cp',decrypted,'td-reliability-20261016-postgres-1:/tmp/reliability-restore.dump']);
  // A new database only: no --clean, DROP, reset or overwrite is permitted.
  compose(['exec','-T','postgres','createdb','-U','aihub','-O','aihub','aihub_restore_reliability']);
  compose(['exec','-T','postgres','pg_restore','-U','aihub','-d','aihub_restore_reliability','--exit-on-error','--single-transaction','/tmp/reliability-restore.dump']);
  await command([...base,'run','--rm','--no-deps','tools','scripts/reliability/check.ts','snapshot-restore'],'restore-snapshot');
  const before=JSON.parse(readFileSync(resolve(evidence,'snapshot.json'),'utf8')),after=JSON.parse(readFileSync(resolve(evidence,'snapshot-restored.json'),'utf8'));
  assert.deepEqual(after,before);assert(before.users.length>0&&before.wallets.length>0&&before.orders.length===2&&before.transactions.length>0);
  const restoredMarkers=compose(['exec','-T','postgres','psql','-U','aihub','-d','aihub_restore_reliability','-At','-c',`SELECT id FROM reliability_backup_marker WHERE id IN ('${marker}','after-${marker}') ORDER BY id`]).trim();
  assert.equal(restoredMarkers,marker);
  const result={dumpStart,dumpComplete,sourceSha256:sourceHash,encryptedSha256:cipherHash,bytes:sourceBytes.length,encryption:'AES-256-GCM; random 96-bit nonce; 128-bit tag; magic authenticated as AAD',
    restoredDataIdentical:true,counts:Object.fromEntries(['users','wallets','orders','transactions','requests'].map(k=>[k,before[k].length])),tamperRejected:true,wrongKeyRejected:true,
    rtoSeconds:(performance.now()-restoreStart)/1000,rpoConservativeSeconds:(Date.parse(disasterAt)-Date.parse(committed.split('\n')[0]))/1000,
    rpoScope:'Local observed pre-dump committed marker to simulated recovery start; no production backup schedule guarantee',
    offsiteTransfer:'NOT AUTHORIZED / NOT VERIFIED',keyStoredSeparately:true,keyOnSameHost:true,fullHostDisasterRecovery:false};
  output('backup-restore',result);console.log(JSON.stringify(result));
  for(const file of [plain,decrypted,corrupt,wrongKey])unlinkSync(file);
  compose(['exec','-T','postgres','rm','/tmp/reliability-audit.dump','/tmp/reliability-restore.dump']);
}
const mode=process.argv[2];
try{isolated();if(mode==='crash')await crash();else if(mode==='load')await load();else if(mode==='suite')await suite();else if(mode==='backup')await backup();
  else if(mode==='backup-guards')await command(['run','--rm','--network','none','--read-only','--tmpfs','/tmp','--tmpfs','/opt/aihub','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--user','0:0','--mount',`type=bind,src=${resolve('deploy/backup.sh')},dst=/tested-backup.sh,readonly`,
    '--mount',`type=bind,src=${resolve('scripts/reliability/backup-guards.sh')},dst=/guard-test.sh,readonly`,
    '--entrypoint','sh','token-depot-reliability-sdk:20261016','/guard-test.sh'],'backup-guards');
  else throw new Error('Unknown mode');}
catch(error){console.error(`Reliability ${mode} failed: ${error.name}; see local evidence. No secret/error command text emitted.`);process.exitCode=1;}
