import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, copyFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import https from 'node:https';

const evidence = resolve('docker-test-results/commercial-20261016/evidence');
mkdirSync(evidence, { recursive: true });
const project = process.env.TD_COMMERCIAL_TEST_PROJECT ?? 'td-commercial-20261016';
assert(/^td-commercial-20\d{6}(?:-[a-z0-9-]{1,24})?$/.test(project), 'Only explicitly named disposable commercial projects are permitted.');
const base = ['compose', '--project-name', project, '--env-file', 'docker-test-results/commercial-20261016/compose.env', '-f', 'deploy/compose.commercial-test.yaml'];
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000, input, stdio: ['pipe', 'pipe', 'pipe'] });
const save = (name, value) => writeFileSync(resolve(evidence, name + '.json'), JSON.stringify(value, null, 2) + '\n');
async function command(args, label) {
  const runId = randomUUID(), startedAt = new Date().toISOString(), directory = resolve(evidence, 'runs', runId);
  mkdirSync(directory, { recursive: true });
  const logPath = resolve(evidence, label + '.log');
  for (const file of [label + '.log', label + '-exit.json', ...(label.startsWith('closed-loop') ? ['test-result.json', 'test-failure.json', 'closed-loop.json', 'pricing-limitation.json', 'pending-order.json'] : [])]) {
    if (existsSync(resolve(evidence, file))) copyFileSync(resolve(evidence, file), resolve(directory, 'previous-' + file));
  }
  const meta = { project, runId, startedAt };
  const record = value => { save(label + '-exit', { ...meta, ...value }); writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({ ...meta, ...value }, null, 2) + '\n'); };
  record({ status: 'RUNNING', code: null });
  writeFileSync(logPath, ''); // Keep partial evidence if Docker or this process stops.
  const started = performance.now(), child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TD_COMMERCIAL_TEST_PROJECT: project, TD_COMMERCIAL_RUN_ID: runId } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => {
    appendFileSync(logPath, value); appendFileSync(resolve(directory, 'output.log'), value); process.stdout.write(value);
  });
  let result;
  try {
    result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    record({ status: result.code === 0 ? 'PASS' : 'FAILED', ...result, durationMs: performance.now() - started, executedAt: new Date().toISOString() });
    if (label.startsWith('closed-loop')) for (const file of ['test-result.json', 'test-failure.json', 'closed-loop.json', 'pricing-limitation.json', 'pending-order.json']) {
      if (existsSync(resolve(evidence, file))) copyFileSync(resolve(evidence, file), resolve(directory, file));
    }
    assert.equal(result.code, 0, 'Isolated acceptance command failed. Inspect the local safe log.');
  } catch (error) {
    record({ status: 'FAILED', code: result?.code ?? null, signal: result?.signal ?? null, durationMs: performance.now() - started, errorClass: error.name, executedAt: new Date().toISOString() });
    throw error;
  }
}
async function verifyEvidenceRecording() {
  const label = 'recording-selftest', manifestPath = resolve(evidence, label + '-exit.json');
  const args = ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', 'token-depot-reliability-sdk:20261016', '-e'];
  await command([...args, 'process.stdout.write("recording-success-only\\n")'], label);
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedFailure = assert.rejects(command([...args, 'process.stdout.write("recording-failure-only\\n");setTimeout(()=>process.exit(7),1500)'], label));
  await new Promise(resolve => setTimeout(resolve, 150));
  const running = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(running.status, 'RUNNING'); assert.equal(running.code, null); assert.notEqual(running.runId, previous.runId);
  await expectedFailure;
  const failed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.code, 7); assert.equal(failed.runId, running.runId);
  const archived = JSON.parse(readFileSync(resolve(evidence, 'runs', running.runId, 'previous-' + label + '-exit.json'), 'utf8'));
  assert.equal(archived.runId, previous.runId); assert.equal(archived.status, 'PASS');
  save('evidence-recording-check', { status: 'PASS', project, checks: ['new run invalidates old PASS before execution', 'failed command retains actual exit 7', 'previous result archived with its original runId'], observedRunningRunId: running.runId, observedFailedCode: failed.code, verifiedAt: new Date().toISOString(), productionOrPaymentCalls: 0 });
  console.log('Evidence recording regression passed; the exit-7 container was an intentional isolated recorder fixture.');
}
async function isolation() {
  const network = JSON.parse(docker(['network', 'inspect', `${project}_sandbox`]))[0]; assert(network.Internal);
  const rows = [];
  for (const name of ['postgres', 'redis', 'suite-postgres', 'suite-redis']) {
    const container = JSON.parse(docker(['inspect', `${project}-${name}-1`]))[0];
    assert.equal(container.Config.Labels['com.docker.compose.project'], project);
    assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null));
    const volumes = container.Mounts.filter(mount => mount.Type === 'volume').map(mount => mount.Name);
    assert(volumes.every(value => value.startsWith(`${project}_`)));
    rows.push({ service: name, volumes, health: container.State.Health?.Status ?? container.State.Status, hostPorts: [] });
  }
  save('isolation', { project, internalNetwork: true, noHostPorts: true, containers: rows, realCredentialsRead: false, paidRequests: 0, productionTransactions: 0 });
}
async function catalog() {
  // Read-only metadata from the PRE-EXISTING local acceptance stack, not a production database.
  const old = JSON.parse(docker(['inspect', 'aihub-docker-test-postgres-1']))[0];
  assert.equal(old.Config.Labels['com.docker.compose.project'], 'aihub-docker-test');
  const sql = 'BEGIN READ ONLY; SELECT COALESCE(json_agg(m),\'[]\') FROM (SELECT slug,name,provider,"providerModel","contextWindow","inputPricePerMillion"::text,"outputPricePerMillion"::text,"markupMultiplier"::text,enabled FROM "Model" ORDER BY slug) m; ROLLBACK;';
  const text = docker(['exec', '-i', 'aihub-docker-test-postgres-1', 'psql', '-U', 'aihub_admin', '-d', 'aihub', '-qAt', '-v', 'ON_ERROR_STOP=1'], sql);
  const models = JSON.parse(text.trim());
  const publicCatalog = await new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', servername: 'localhost', port: 8443, path: '/api/models', rejectUnauthorized: false, headers: { Host: 'localhost:8443' } }, response => {
      let body = ''; response.on('data', value => { body += value; }); response.on('end', () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }); request.setTimeout(10000, () => request.destroy()); request.on('error', reject);
  });
  save('existing-local-catalog', { source: 'aihub-docker-test local acceptance instance; NOT production', readOnly: true, models, publicCatalog, queriedAt: new Date().toISOString() });
  console.log(`Existing isolated catalog: ${models.length} database models; ${publicCatalog.models.length} public listings.`);
}
function configurationMetadata() {
  const files = ['.env', '.env.local', '.env.production', 'deploy/secrets/app.env', 'deploy/secrets/alipay-private.pem', 'deploy/secrets/wechat-private.pem'];
  // Only stat: never read a real env or key file, not even for presence of values.
  save('configuration-metadata', { mode: 'Path/existence/mtime only; secret contents and provider account validity NOT inspected', files: files.map(path => ({ path, exists: existsSync(path), ...(existsSync(path) ? { modifiedAt: statSync(path).mtime.toISOString() } : {}) })),
    providerVariables: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'], paymentSwitch: 'PAYMENTS_ENABLED', merchantConfiguration: 'Unverified; no production credentials loaded', updatedAt: new Date().toISOString() });
}
function verifySourceSnapshot() {
  // Hash only application source trees, never env, data volumes or credentials.
  const program = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
    const result={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
    if(e.isDirectory())walk(p);else if(e.isFile())result[p.split(path.sep).join('/')]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}
    for(const dir of ['app','lib','components','prisma'])walk(dir);process.stdout.write(JSON.stringify(result));`;
  const current = JSON.parse(execFileSync(process.execPath, ['-e', program], { encoding: 'utf8' }));
  const snapshot = JSON.parse(docker(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', 'token-depot-reliability-sdk:20261016', '-e', program]));
  const differingFiles = [...new Set([...Object.keys(current), ...Object.keys(snapshot)])].filter(file => current[file] !== snapshot[file]);
  save('source-snapshot', { image: 'token-depot-reliability-sdk:20261016', checkedTrees: ['app', 'lib', 'components', 'prisma'], files: Object.keys(current).length, differingFiles, checkedAt: new Date().toISOString() });
  assert.equal(differingFiles.length, 0, 'Test runtime source differs from the current business source; rebuild before claiming regression coverage.');
  console.log(`Test image business source verified: ${Object.keys(current).length} files, no differences.`);
}
try {
  const mode = process.argv[2];
  if (mode === 'metadata') configurationMetadata();
  else { await isolation();
    if (mode === 'loop') await command([...base, 'run', '--rm', '--no-deps', 'tools'], 'closed-loop-final');
    else if (mode === 'suite') await command([...base, 'run', '--rm', '--no-deps', 'suite-tools'], 'regression-final');
    else if (mode === 'build') await command(['build', '--target', 'runner', '-t', 'token-depot-commercial-acceptance:20261016', '.'], 'production-build');
    else if (mode === 'catalog') await catalog();
    else if (mode === 'source') verifySourceSnapshot();
    else if (mode === 'evidence-check') await verifyEvidenceRecording();
    else throw new Error('Unknown acceptance mode');
  }
} catch (error) { console.error(`Commercial acceptance failed (${error.name}); inspect local evidence. No secret or raw command error emitted.`); process.exitCode = 1; }
