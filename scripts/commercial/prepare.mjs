import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// New, disposable local fixture only. Never open the real project's env files.
const root = resolve('docker-test-results/commercial-20261016');
if (existsSync(resolve(root, 'secrets/test.env'))) throw new Error('Retaining the existing commercial fixture; refusing to overwrite secrets.');
for (const name of ['secrets', 'evidence']) mkdirSync(resolve(root, name), { recursive: true, mode: 0o700 });
const databasePassword = randomBytes(32).toString('hex'), redisPassword = randomBytes(32).toString('hex');
const database = `postgresql://aihub:${databasePassword}@127.0.0.1:5432/`;
const env = { DATABASE_URL: database + 'aihub', DATABASE_URL_TEST: database + 'aihub_auth_test',
  REDIS_URL: `redis://:${redisPassword}@127.0.0.1:6379/0`, REDIS_URL_TEST: `redis://:${redisPassword}@127.0.0.1:6379/15`,
  NODE_ENV: 'test', TD_COMMERCIAL_ISOLATED: '1', IP_HASH_SECRET: randomBytes(32).toString('hex'),
  PAYMENTS_ENABLED: 'false', SEO_INDEXING_ENABLED: 'false', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '',
  PYTHON_TEST_EXECUTABLE: '/opt/token-depot-sdk/bin/python3', PYTHON_TEST_PATH: '/opt/token-depot-sdk/lib/python3.11/site-packages', PYTHONPATH: '' };
const files = { 'db-password': databasePassword, 'redis-password': redisPassword,
  'test.env': Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n' };
for (const [name, body] of Object.entries(files)) writeFileSync(resolve(root, 'secrets', name), body, { mode: 0o600, flag: 'wx' });
writeFileSync(resolve(root, 'compose.env'), '# Nonsecret test-only Compose interpolation.\n', { flag: 'wx' });
console.log('Created fresh isolated commercial fixture. No real credentials read; values suppressed.');
