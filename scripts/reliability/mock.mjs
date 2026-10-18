import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
let active = 0, peak = 0, calls = 0, disconnected = 0;
const activeByModel = {}, peakByModel = {};
const server = createServer(async (req, res) => {
  if (req.url === '/metrics') return res.end(JSON.stringify({active, peak, calls, disconnected,activeByModel,peakByModel}));
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  if (req.headers.authorization !== `Bearer ${process.env.DEEPSEEK_API_KEY}`) { res.writeHead(401).end(); return; }
  const buffers = []; for await (const chunk of req) buffers.push(chunk);
  const body = JSON.parse(Buffer.concat(buffers).toString('utf8'));
  const mode = body.model.replace(/^reliability-/, '');
  calls++; active++; peak = Math.max(peak, active);
  activeByModel[mode]=(activeByModel[mode]??0)+1;peakByModel[mode]=Math.max(peakByModel[mode]??0,activeByModel[mode]);
  let finished = false;
  res.once('close', () => { active--;activeByModel[mode]--; if (!finished) disconnected++; });
  if (mode === 'timeout') return;
  if (mode === '429' || mode === '500') {
    finished = true;
    res.writeHead(Number(mode), {'content-type':'application/json','retry-after':'1'}).end(JSON.stringify({error:{code:mode==='429'?'rate_limit_exceeded':'internal_error'}})); return;
  }
  const usage = {prompt_tokens:12,completion_tokens:7,total_tokens:19};
  await delay(10);
  if (!body.stream) { finished=true; res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{index:0,message:{role:'assistant',content:'Fixture response'},finish_reason:'stop'}],usage})); return; }
  res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-store'});
  const send = value => res.write(`data: ${typeof value==='string'?value:JSON.stringify(value)}\n\n`);
  send({choices:[{index:0,delta:{role:'assistant',content:'Fixture '},finish_reason:null}]});
  if (mode === 'hold' || mode === 'restart') return;
  if (mode === 'network') { await delay(20); res.destroy(); return; }
  // Hold load-test streams for one second so concurrent connection admission
  // and resource samples observe actual open streams, not just short JSON work.
  await delay(mode.startsWith('load') ? 1000 : mode === 'slow' ? 150 : 20); if (res.destroyed) return;
  send({choices:[{index:0,delta:{content:'response'},finish_reason:null}]});
  send({choices:[{index:0,delta:{},finish_reason:'stop'}],usage});
  send('[DONE]'); finished = true; res.end();
});
server.listen(3199,'127.0.0.1',()=>console.log('Isolated Mock Provider ready; request bodies and credentials are not logged.'));
