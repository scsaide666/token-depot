import assert from 'node:assert/strict';
import { createServer, connect, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { evalRisk, closeRiskRedis, RiskUnavailable } from '../../lib/risk/redis';

// Real Redis protocol through a loopback-only delaying TCP proxy. This does not
// pause the shared server, change quotas or use real application credentials.
const original=new URL(process.env.REDIS_URL!);assert.equal(original.hostname,'127.0.0.1');
const sockets=new Set<Socket>();let buffering=false,bytes:Buffer[]=[],target:Socket|undefined,connections=0;
const proxy=createServer(client=>{
  connections++;const upstream=connect(6379,'127.0.0.1');sockets.add(client);sockets.add(upstream);
  client.pipe(upstream);
  upstream.on('data',chunk=>{if(buffering){bytes.push(Buffer.from(chunk));target=client;}else client.write(chunk);});
  for(const s of [client,upstream]){s.on('error',()=>{});s.on('close',()=>{sockets.delete(s);if(s===client)upstream.destroy();else client.destroy();});}
});
async function main(){
await new Promise<void>(resolve=>proxy.listen(6388,'127.0.0.1',resolve));
original.port='6388';process.env.REDIS_URL=original.href;process.env.UPSTASH_REDIS_REST_URL='';process.env.UPSTASH_REDIS_REST_TOKEN='';
const expectFixed=process.argv.includes('--expect-fixed');
try{
  assert.equal(await evalRisk('return 42',[],[]),42);
  buffering=true;const started=performance.now();
  const first=evalRisk('return 101',[],[]).then(v=>({ok:true,value:v}),e=>({ok:false,closed:e instanceof RiskUnavailable}));
  await delay(800);
  const second=evalRisk('return 202',[],[]).then(v=>({ok:true,value:v}),e=>({ok:false,closed:e instanceof RiskUnavailable}));
  await delay(1950);buffering=false;
  if(target&&!target.destroyed)for(const chunk of bytes)target.write(chunk);bytes=[];
  const results=await Promise.all([first,second]);
  if(expectFixed){assert(!results[0].ok,'The expired request must stay fail-closed.');assert(results[1].ok,'One command timeout must not destroy a healthy shared connection and unrelated command.');assert.equal('value' in results[1]?results[1].value:0,202);}
  else assert(results[0].ok&&performance.now()-started>2500,'Baseline missing in-flight deadline was not reproduced.');
  assert.equal(await evalRisk('return 303',[],[]),303);
  if(expectFixed){
    buffering=true;
    const burst=Array.from({length:2050},()=>evalRisk('return 404',[],[]).then(v=>v===404,()=>false));
    await delay(150);buffering=false;
    if(target&&!target.destroyed)for(const chunk of bytes)target.write(chunk);bytes=[];
    const settled=await Promise.all(burst),successful=settled.filter(Boolean).length;
    const baseline=process.argv.includes('--queue-baseline');
    if(baseline)assert.equal(successful,0,'Queue failure cascade was not reproduced.');
    else assert.equal(successful,2048,'Only capacity excess may fail; admitted commands retain their shared connection.');
    assert.equal(await evalRisk('return 505',[],[]),505);
    writeFileSync(`/evidence/redis-queue-${baseline?'before':'after'}.json`,JSON.stringify({successful,rejected:2050-successful,connections,limit:2048},null,2));
  }
  const output={expectFixed,results,connections,elapsedMs:performance.now()-started,timeoutMs:2500,replyDelayMs:2750,secondOwnDeadlineMs:3300,requestStillFailClosed:!results[0].ok};
  writeFileSync(`/evidence/redis-delay-${expectFixed?'after':'before'}.json`,JSON.stringify(output,null,2));
  console.log(`PASS ${expectFixed?'isolated timeout; unrelated command succeeds; reply mapping and subsequent use preserved':'reproduced missing in-flight response deadline; late command incorrectly succeeds'}`);
}finally{
  await closeRiskRedis();for(const s of sockets)s.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));
}
}
void main().catch(error=>{console.error(JSON.stringify({name:error.name,assertion:error instanceof assert.AssertionError?error.message:undefined}));process.exitCode=1;});
