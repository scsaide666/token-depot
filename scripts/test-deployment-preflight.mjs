import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnvironment, checkPrelaunchConfiguration } from './check-deployment.mjs';

const composeTemplate = parseEnvironment(readFileSync('.env.production.example', 'utf8'));
const appTemplate = parseEnvironment(readFileSync('deploy/app.env.example', 'utf8'));
const secrets = { admin: randomBytes(32).toString('hex'), app: randomBytes(32).toString('hex'), redis: randomBytes(32).toString('hex') };
// Syntax-only fictional domains/digests. No DNS, Docker, provider or payment calls.
const compose = { ...composeTemplate, SITE_DOMAIN: 'fixture-only.unit', API_DOMAIN: 'api.fixture-only.unit', ACME_EMAIL: 'ops@fixture-only.unit' };
for (const field of ['APP_IMAGE', 'TOOLS_IMAGE', 'CADDY_IMAGE']) compose[field] = 'audit/fixture@sha256:' + 'a1'.repeat(32);
const app = { ...appTemplate, SITE_OPERATOR_NAME: 'Isolated fixture only', SITE_CONTACT_EMAIL: 'support@fixture-only.unit', APP_ORIGIN: 'https://fixture-only.unit', PAYMENT_NOTIFY_ORIGIN: 'https://fixture-only.unit',
  DATABASE_URL: `postgresql://aihub:${secrets.app}@postgres:5432/aihub?schema=public`, REDIS_URL: `redis://:${secrets.redis}@127.0.0.1:6379/0`, IP_HASH_SECRET: randomBytes(32).toString('hex') };
let passed = 0;
function test(name, run) { run(); passed += 1; console.log(`PASS ${name}`); }
function rejects(field, value, scope = 'app') {
  const result = checkPrelaunchConfiguration(scope === 'compose' ? { ...compose, [field]: value } : compose, scope === 'app' ? { ...app, [field]: value } : app, secrets);
  assert.equal(result.configurationValid, false);
  assert(result.issues.length > 0);
  assert(!JSON.stringify(result).includes(value) || value.length < 16, 'Never echo invalid configuration contents.');
}
test('Template declares all required fields while remaining unconfigured', () => {
  const result = checkPrelaunchConfiguration(composeTemplate, appTemplate);
  assert(!result.configurationValid); assert(!result.commercialLaunchApproved);
  assert(!result.issues.some(issue => issue.code === 'MISSING_VARIABLE'));
});
test('Valid isolated syntax never means commercial launch approval', () => { const result = checkPrelaunchConfiguration(compose, app, secrets); assert(result.configurationValid); assert(!result.commercialLaunchApproved); });
test('No implicit env evaluation or shell interpolation', () => { assert.throws(() => parseEnvironment('SECRET=$(cat /not-executed)')); assert.throws(() => parseEnvironment('A=${SECRET}')); });
test('Duplicate variables and multiline values fail closed', () => { assert.throws(() => parseEnvironment('A=1\nA=2')); assert.throws(() => parseEnvironment('A="unterminated\nB=1')); });
test('BOM, CRLF and literal quoting are parsed without env mutation', () => { assert.equal(parseEnvironment('\uFEFFA="literal"\r\n# comment\r\nB=')["A"], 'literal'); });
test('Placeholder domains cannot pass production configuration', () => rejects('SITE_DOMAIN', 'token-depot.example', 'compose'));
test('API domain must match the reserved subdomain', () => rejects('API_DOMAIN', 'another-domain.unit', 'compose'));
test('Unreviewed mutable image tags are rejected', () => rejects('APP_IMAGE', 'audit/fixture:latest', 'compose'));
test('Notify URL must use the main site', () => rejects('PAYMENT_NOTIFY_ORIGIN', 'https://api.fixture-only.unit'));
test('Public HTTP origins are rejected', () => rejects('APP_ORIGIN', 'http://fixture-only.unit'));
test('Payments and indexing remain off before launch approval', () => { rejects('PAYMENTS_ENABLED', 'true'); rejects('SEO_INDEXING_ENABLED', 'true'); });
test('Database administrator cannot be used by the app', () => rejects('DATABASE_URL', `postgresql://aihub_admin:${secrets.app}@postgres:5432/aihub?schema=public`));
test('Nonprivate database address is rejected', () => rejects('DATABASE_URL', `postgresql://aihub:${secrets.app}@public-db.unit:5432/aihub?schema=public`));
test('Remote or unauthenticated Redis is rejected', () => { rejects('REDIS_URL', 'redis://127.0.0.1:6379/0'); rejects('REDIS_URL', `redis://:${secrets.redis}@redis:6379/0`); });
test('Independent secrets and matching mounted passwords are required', () => { assert(!checkPrelaunchConfiguration(compose, { ...app, IP_HASH_SECRET: secrets.app }, secrets).configurationValid); assert(!checkPrelaunchConfiguration(compose, app, { ...secrets, app: secrets.redis }).configurationValid); });
test('Weak placeholder secrets cannot pass', () => rejects('IP_HASH_SECRET', '0'.repeat(64)));
test('Real provider credentials are not accepted by this pre-launch gate', () => rejects('DEEPSEEK_API_KEY', 'fixture-sentinel-do-not-print-this-value'));
test('Test and browser-exposed secret variables are rejected', () => { rejects('DATABASE_URL_TEST', 'fixture-sentinel-do-not-print-this-value'); rejects('NEXT_PUBLIC_PROVIDER_KEY', 'fixture-sentinel-do-not-print-this-value'); });
test('Pool increases and nonofficial upstream cannot bypass the gate', () => { rejects('DATABASE_POOL_MAX', '100'); rejects('DEEPSEEK_BASE_URL', 'https://unapproved-provider.unit'); });
test('No credentials or configuration values appear in result JSON', () => { const output = JSON.stringify(checkPrelaunchConfiguration(compose, app, secrets)); for (const secret of Object.values(secrets)) assert(!output.includes(secret)); assert(!output.includes(app.IP_HASH_SECRET)); });
test('Missing explicit fields cannot silently use defaults', () => { const missing = { ...app }; delete missing.TRUSTED_IP_HEADER; assert(!checkPrelaunchConfiguration(compose, missing, secrets).configurationValid); });
console.log(JSON.stringify({ passed, failed: 0, realProviderCalls: 0, realPaymentCalls: 0 }));
