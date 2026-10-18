import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { generateApiKey } from '../../lib/server/api-key-crypto';
import { hashPassword } from '../../lib/server/password';
import { money } from '../../lib/billing/money';
import { settleSuccess, settleFailure } from '../../lib/billing/wallet';
import { getDb } from '../../lib/server/db';

// No dotenv: only explicitly mounted NEW fixture credentials can enter this process.
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/aihub_auth_test');
assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
if(process.argv[2]==='snapshot-restore')url.pathname='/aihub_restore_reliability';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString:url.href, max:3 }), log:[] });
type Identity = {userId:string; apiKeyId:string; key:string};
type State = {users:Identity[]; models:Record<string,string>; adminId:string; restartId?:string; restartUser?:string};
const statePath='/evidence/fixture-private.json';
const phase=process.argv[2] ?? 'flows';
const write=(name:string,value:unknown)=>writeFileSync(`/evidence/${name}.json`,JSON.stringify(value,null,2),{mode:0o600});
const state=()=>JSON.parse(readFileSync(statePath,'utf8')) as State;
function chat(identity:Identity, model:string, options:{stream?:boolean;cancel?:boolean}={}) {
  return new Promise<{status:number;requestId:string;done:number;error?:string;latency:number;ttft:number|null}>((resolve,reject)=>{
    const start=performance.now(); let text='', ttft:number|null=null, finished=false;
    const req=httpsRequest({hostname:'caddy',servername:'localhost',port:9443,path:'/v1/chat/completions',method:'POST',rejectUnauthorized:false,
      headers:{host:'localhost:9443',authorization:`Bearer ${identity.key}`,'content-type':'application/json'}},res=>{
      const id=String(res.headers['x-request-id']??'');
      const finish=()=>{if(finished)return;finished=true; const error=/"code":"([a-z_]+)"/.exec(text)?.[1];resolve({status:res.statusCode!,requestId:id,
        done:(text.match(/data: \[DONE\]/g)??[]).length,error,latency:performance.now()-start,ttft});};
      res.on('data',b=>{text+=b.toString();if(ttft===null&&/"content":"[^"\n]+/.test(text)){ttft=performance.now()-start;if(options.cancel){res.destroy();req.destroy();finish();}}});
      res.on('end',finish);res.on('close',finish);res.on('error',e=>{if(options.cancel)finish();else reject(e);});
    });
    req.on('error',e=>{if(!finished)reject(e);});req.setTimeout(60000,()=>req.destroy(new Error('fixture_client_timeout')));
    req.end(JSON.stringify({model,messages:[{role:'user',content:'Isolated reliability fixture'}],max_tokens:32,
      stream:options.stream??true,stream_options:{include_usage:true}}));
  });
}
async function waitTerminal(id:string){
  for(let i=0;i<100;i++){const r=await db.apiRequest.findUnique({where:{requestId:id}});if(r&&r.status!=='PENDING')return r;await delay(100);}
  throw new Error('terminal_request_timeout');
}
async function audit(){
  const rows=await db.$queryRaw<{negative:bigint;held:bigint;mismatch:bigint;badLedger:bigint;successMissing:bigint;failureCharged:bigint;pending:bigint}[]>`
    SELECT
      (SELECT COUNT(*) FROM "Wallet" WHERE balance<0 OR "reservedBalance"<0 OR balance<"reservedBalance") AS negative,
      (SELECT COUNT(*) FROM "Wallet" WHERE "reservedBalance"<>0) AS held,
      (SELECT COUNT(*) FROM "Wallet" w WHERE w.balance<>COALESCE((SELECT SUM(t.amount) FROM "WalletTransaction" t WHERE t."walletId"=w.id),0)) AS mismatch,
      (SELECT COUNT(*) FROM "WalletTransaction" WHERE "balanceAfter"<>"balanceBefore"+amount) AS "badLedger",
      (SELECT COUNT(*) FROM "ApiRequest" r WHERE status='SUCCESS' AND NOT EXISTS(SELECT 1 FROM "WalletTransaction" t WHERE t."requestId"=r."requestId" AND t.amount=-r."userCost")) AS "successMissing",
      (SELECT COUNT(*) FROM "ApiRequest" r JOIN "WalletTransaction" t ON t."requestId"=r."requestId" WHERE r.status='FAILED' AND t.type='USAGE') AS "failureCharged",
      (SELECT COUNT(*) FROM "ApiRequest" WHERE status='PENDING') AS pending`;
  const result=Object.fromEntries(Object.entries(rows[0]).map(([k,v])=>[k,Number(v)]));
  assert(Object.values(result).every(v=>v===0),`Ledger invariant failure: ${JSON.stringify(result)}`); return result;
}
async function seed(){
  const s:State={users:[],models:{},adminId:randomUUID()};
  const passwordHash=await hashPassword(randomUUID()+randomUUID());
  await db.user.create({data:{id:s.adminId,name:'Isolated Audit Admin',email:`admin-${randomUUID()}@example.test`,passwordHash,role:'ADMIN'}});
  for(let n=0;n<505;n++){
    const userId=randomUUID(),walletId=randomUUID(),apiKeyId=randomUUID(),key=generateApiKey();
    const balance=n===504?'0':'10';
    await db.user.create({data:{id:userId,name:'Isolated Reliability Fixture',email:`fixture-${n}-${randomUUID()}@example.test`,passwordHash,
      wallet:{create:{id:walletId,balance}},apiKeys:{create:{id:apiKeyId,name:'Isolated fixture',keyHash:key.keyHash,keyPrefix:key.keyPrefix}}}});
    if(balance!=='0')await db.walletTransaction.create({data:{walletId,type:'ADMIN_ADJUSTMENT',amount:balance,balanceBefore:'0',balanceAfter:balance,
      adminId:s.adminId,adjustmentId:randomUUID(),reason:'Isolated reliability test funding',description:'Synthetic fixture funding; no payment'}});
    s.users.push({userId,apiKeyId,key:key.key});
  }
  for(const mode of ['success','slow','hold','timeout','429','500','network','restart',...['10','30','50','100','200','300','500'].map(n=>'load'+n)]){
    const model=await db.model.create({data:{slug:`audit-${mode}`,name:`Reliability ${mode}`,provider:'DEEPSEEK',providerModel:`reliability-${mode}`,
      description:'Isolated Mock only',contextWindow:128000,inputPricePerMillion:'2',outputPricePerMillion:'8',markupMultiplier:'1.25'}});
    s.models[mode]=model.slug;
    const channel=await db.providerChannel.create({data:{code:`audit-${mode}`,name:'Isolated Mock',provider:'DEEPSEEK',apiKeyEnv:'DEEPSEEK_API_KEY',baseUrlEnv:'DEEPSEEK_BASE_URL',
      timeoutMs:mode==='hold'||mode==='restart'?120000:3000,rpm:60,tpm:200000,concurrency:10}});
    await db.modelChannel.create({data:{modelId:model.id,channelId:channel.id,providerModel:model.providerModel,contextWindow:model.contextWindow,
      inputPricePerMillion:model.inputPricePerMillion,outputPricePerMillion:model.outputPricePerMillion}});
  }
  for(const method of ['ALIPAY','WECHAT'] as const)await db.paymentOrder.create({data:{userId:s.users[0].userId,
    orderNo:`REL${randomUUID().replaceAll('-','').slice(0,27)}`,idempotencyKey:randomUUID(),method,amount:'50',merchantId:'fixture-only',appId:'fixture-only',expiresAt:new Date(Date.now()+300000)}});
  writeFileSync(statePath,JSON.stringify(s),{mode:0o600});console.log('PASS seeded 505 isolated users, audited funding entries and Mock-only models; credentials suppressed.');
}
async function flows(){
  const s=state(),results:unknown[]=[];
  const check=async(name:string,fn:()=>Promise<unknown>)=>{const value=await fn();results.push({name,passed:true,...(value as object??{})});write('flows',results);console.log(`PASS ${name}`);};
  await check('Normal SSE through Caddy Gateway Mock and PostgreSQL ledger',async()=>{
    const r=await chat(s.users[0],s.models.success);console.log(JSON.stringify({probeStatus:r.status,probeError:r.error}));assert.equal(r.status,200);assert.equal(r.done,1);
    const row=await waitTerminal(r.requestId);assert.equal(row.status,'SUCCESS');assert.equal(row.totalTokens,19);assert.equal(row.userCost!.toFixed(20),'0.00010000000000000000');
    return {requestId:r.requestId,latency:r.latency,ttft:r.ttft,cost:row.userCost!.toFixed(20)};
  });
  for(const mode of ['hold','timeout','429','500','network'])await check(mode==='hold'?'Client disconnect':`Provider ${mode}`,async()=>{
    const r=await chat(s.users[1],s.models[mode],{cancel:mode==='hold'});const row=await waitTerminal(r.requestId);
    assert.equal(row.status,'FAILED');assert.equal(row.userCost!.toFixed(20),money('0').toFixed(20));
    assert.equal(await db.walletTransaction.count({where:{requestId:r.requestId}}),0);
    if(['hold','timeout','500','network'].includes(mode))assert.equal(row.providerCostStatus,'PENDING_RECONCILIATION');
    if(mode==='429')assert.equal(row.providerCostStatus,'NOT_INCURRED');
    return {requestId:r.requestId,http:r.status,errorCode:row.errorCode,costStatus:row.providerCostStatus};
  });
  await check('Insufficient balance has no upstream attempt or charge',async()=>{
    const r=await chat(s.users[504],s.models.success);assert.equal(r.status,402);assert.equal(r.error,'insufficient_balance');
    const row=await waitTerminal(r.requestId);assert.equal(row.status,'FAILED');assert.equal(await db.providerAttempt.count({where:{requestId:r.requestId}}),0);
  });
  await check('25 same-key streams preserve default concurrency admission',async()=>{
    const results=await Promise.all(Array.from({length:25},()=>chat(s.users[2],s.models.slow)));
    const ok=results.filter(r=>r.status===200);assert(ok.length>0);assert(results.some(r=>r.status===429));
    for(const r of results)await waitTerminal(r.requestId);
    return {http:results.reduce((out,r)=>({...out,[r.status]:(out[r.status]??0)+1}),{} as Record<number,number>)};
  });
  await check('Concurrent settlement retry and release cannot duplicate charge',async()=>{
    const row=await db.apiRequest.findFirstOrThrow({where:{status:'SUCCESS'},orderBy:{createdAt:'asc'}});
    const before=await db.wallet.findUniqueOrThrow({where:{userId:row.userId}});
    await Promise.all(Array.from({length:10},()=>settleSuccess(row.userId,row.requestId,{inputTokens:12,outputTokens:7,totalTokens:19},1)));
    await Promise.all(Array.from({length:10},()=>settleFailure(row.userId,row.requestId,'request_cancelled',1)));
    assert.equal(await db.walletTransaction.count({where:{requestId:row.requestId}}),1);
    assert.equal((await db.wallet.findUniqueOrThrow({where:{userId:row.userId}})).balance.toString(),before.balance.toString());
  });
  write('ledger-after-flows',await audit());
}
async function restartPending(){
  const s=state();const r=await chat(s.users[3],s.models.restart,{cancel:true});await waitTerminal(r.requestId);
  // A second long stream is held open until the host SIGKILLs ONLY this test app.
  console.log('RESTART_READY');
  await new Promise<void>((resolve,reject)=>{
    const req=httpsRequest({hostname:'caddy',servername:'localhost',port:9443,path:'/v1/chat/completions',method:'POST',rejectUnauthorized:false,
      headers:{host:'localhost:9443',authorization:`Bearer ${s.users[4].key}`,'content-type':'application/json'}},res=>{
      s.restartId=String(res.headers['x-request-id']);s.restartUser=s.users[4].userId;writeFileSync(statePath,JSON.stringify(s),{mode:0o600});
      write('restart-pending',{requestId:s.restartId,userId:s.restartUser,createdAt:new Date().toISOString()});
      res.on('data',()=>{});res.on('close',()=>resolve());res.on('error',()=>resolve());
    });req.on('error',()=>resolve());req.setTimeout(30000,()=>{req.destroy();reject(new Error('Host did not restart isolated app in time'));});
    req.end(JSON.stringify({model:s.models.restart,messages:[{role:'user',content:'Restart fixture'}],max_tokens:32,stream:true}));
  });
}
async function expire(){
  const s=state();assert(s.restartId);const row=await db.apiRequest.findUniqueOrThrow({where:{requestId:s.restartId}});
  assert.equal(row.status,'PENDING');assert((await db.wallet.findUniqueOrThrow({where:{userId:row.userId}})).reservedBalance.gt(0));
  // Accelerate only the test lease's clock, never production TTL or business code.
  await db.apiRequest.update({where:{requestId:s.restartId},data:{reservationExpiresAt:new Date(Date.now()-1000)}});
  write('restart-crash',{requestId:s.restartId,pendingAfterSIGKILL:true,reservedAmount:row.reservedAmount.toFixed(20),testClockAccelerated:true});
}
async function verifyRecovery(){
  const s=state();assert(s.restartId);const row=await waitTerminal(s.restartId);
  assert.equal(row.errorCode,'reservation_expired');assert.equal(row.providerCostStatus,'PENDING_RECONCILIATION');
  assert.equal(await db.walletTransaction.count({where:{requestId:s.restartId}}),0);
  write('recovery', {requestId:s.restartId,status:row.status,errorCode:row.errorCode,costStatus:row.providerCostStatus,...await audit()});
  console.log('PASS crash reservation recovered exactly once; unknown upstream cost retained for reconciliation.');
}
async function load(){
  const s=state(), results:unknown[]=[]; let stopped=false;
  const redis=createClient({url:process.env.REDIS_URL});redis.on('error',()=>{});await redis.connect();
  // All production limit defaults remain enabled: 60 RPM, 200K TPM, 10 concurrent/key,
  // 300 IP RPM, and provider channel 60 RPM / 10 concurrent. Distinct stages wait
  // a full minute so previous windows cannot contaminate the next burst.
  for(const count of [10,30,50,100,200,300,500]){
    console.log(`WAIT clean rate window before ${count} VU`);await delay(61000);
    const samples:unknown[]=[];let sampling=true;
    const sample=async()=>{while(sampling){try{
      const [connections,mock,info]=await Promise.all([
        db.$queryRaw<{connections:bigint;active:bigint;locks:bigint}[]>`SELECT COUNT(*) AS connections,COUNT(*) FILTER(WHERE state='active') AS active,COUNT(*) FILTER(WHERE "wait_event_type"='Lock') AS locks FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`,
        fetch('http://127.0.0.1:3199/metrics').then(r=>r.json()),redis.info()]);
      const field=(name:string)=>Number(new RegExp(`(?:^|\\n)${name}:(\\d+)`).exec(info)?.[1]??'0');
      samples.push({at:new Date().toISOString(),database:Object.fromEntries(Object.entries(connections[0]).map(([k,v])=>[k,Number(v)])),mock,
        redis:{ready:redis.isReady,clients:field('connected_clients'),blocked:field('blocked_clients'),usedMemoryBytes:field('used_memory'),evictedKeys:field('evicted_keys'),rejectedConnections:field('rejected_connections')}});
    }catch{samples.push({sampleError:true});}await delay(250);}};
    const startedAt=new Date().toISOString();write('active-phase',{phase:`load-${count}`,at:startedAt});const loop=sample();const started=performance.now();
    const raw=await Promise.all(Array.from({length:count},async(_,i)=>{
      try{return await chat(s.users[i],s.models['load'+count]);}catch(e){return {status:0,error:(e as Error).message,latency:performance.now()-started,requestId:'',done:0,ttft:null};}
    }));
    const elapsed=(performance.now()-started)/1000;sampling=false;await loop;
    const http:Record<number,number>={},errors:Record<string,number>={};
    for(const r of raw){http[r.status]=(http[r.status]??0)+1;if(r.error)errors[r.error]=(errors[r.error]??0)+1;}
    const ok=raw.filter(r=>r.status===200&&r.done===1), unexpected=raw.filter(r=>![200,429].includes(r.status)||r.status===200&&r.done!==1);
    const times=raw.map(r=>r.latency).sort((a,b)=>a-b);const q=(p:number)=>Math.round(times[Math.ceil(times.length*p)-1]*100)/100;
    const finalMock=await fetch('http://127.0.0.1:3199/metrics').then(r=>r.json()) as {peakByModel:Record<string,number>};
    const ledger=await audit();const result={vus:count,startedAt,finishedAt:new Date().toISOString(),requests:raw.length,success:ok.length,elapsedSeconds:elapsed,rps:raw.length/elapsed,successRps:ok.length/elapsed,
      upstreamStreamPeak:finalMock.peakByModel['load'+count]??0,
      p50:q(.5),p95:q(.95),p99:q(.99),unexpectedErrorRate:unexpected.length/raw.length,http,errors,samples,ledger,raw};
    results.push(result);write('load',results);console.log(JSON.stringify({...result,samples:undefined,raw:undefined}));
    if(unexpected.length/raw.length>=0.05||existsSync('/evidence/stop-load.json')){stopped=true;console.log('STOP escalation: unexpected error rate >=5% or resource guard; no higher level will be attempted.');break;}
  }
  if(redis.isOpen)redis.destroy();write('load-completion',{stoppedForSafety:stopped,complete:!stopped});
}
async function snapshot(){
  const [users,wallets,orders,transactions,requests]=await Promise.all([
    db.$queryRaw`SELECT id,name,email,role,status FROM "User" ORDER BY id`,
    db.$queryRaw`SELECT id,"userId",balance::text,"reservedBalance"::text FROM "Wallet" ORDER BY id`,
    db.$queryRaw`SELECT id,"userId",status,amount::text,"orderNo",method FROM "PaymentOrder" ORDER BY id`,
    db.$queryRaw`SELECT id,"walletId",amount::text,"balanceBefore"::text,"balanceAfter"::text,"requestId",type FROM "WalletTransaction" ORDER BY id`,
    db.$queryRaw`SELECT "requestId",status,"userCost"::text,"providerCost"::text,"providerCostStatus","totalTokens" FROM "ApiRequest" ORDER BY "requestId"`]);
  // Stored only in ignored local evidence. Passwords and API hashes are excluded.
  write(phase==='snapshot-restore'?'snapshot-restored':'snapshot',{users,wallets,orders,transactions,requests,ledger:await audit()});
}
async function main(){
  if(phase==='seed')await seed();else if(phase==='flows')await flows();else if(phase==='restart')await restartPending();
  else if(phase==='expire')await expire();else if(phase==='recovery')await verifyRecovery();else if(phase==='load')await load();
  else if(phase==='snapshot'||phase==='snapshot-restore')await snapshot();else if(phase==='audit')write('ledger-final',await audit());else throw new Error('Unknown phase');
}
main().catch(e=>{console.error(JSON.stringify({phase,error:e instanceof assert.AssertionError?e.message:(e as Error).name,stack:(e as Error).stack?.split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3)}));process.exitCode=1;})
  .finally(async()=>{await db.$disconnect();await getDb().$disconnect();});
