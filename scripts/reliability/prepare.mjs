import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// Generates NEW isolated fixture credentials; never opens a real environment file.
const directory = resolve('docker-test-results/reliability-20261016');
if (existsSync(resolve(directory, 'secrets/app.env'))) throw new Error('Existing reliability fixture retained; refusing to overwrite secrets.');
mkdirSync(resolve(directory, 'secrets'), { recursive: true, mode: 0o700 });
mkdirSync(resolve(directory, 'evidence'), { recursive: true });
writeFileSync(resolve(directory,'compose.env'),'# Nonsecret local Compose configuration; never load the real project .env.\n',{flag:'wx'});
const password = randomBytes(32).toString('hex');
const redisPassword = randomBytes(32).toString('hex');
const database = `postgresql://aihub:${password}@127.0.0.1:5432/aihub_auth_test`;
const shared = { DATABASE_URL: database, DATABASE_URL_TEST: database,
  REDIS_URL: `redis://:${redisPassword}@127.0.0.1:6379/0`,
  REDIS_URL_TEST: `redis://:${redisPassword}@127.0.0.1:6379/15`,
  IP_HASH_SECRET: randomBytes(32).toString('hex'), REDIS_NAMESPACE: 'reliability-20261016',
  APP_ORIGIN: 'https://localhost:9443', SEO_INDEXING_ENABLED: 'false', PAYMENTS_ENABLED: 'false',
  AIHUB_LOCAL_PROVIDER_TESTS: 'true', TRUSTED_IP_HEADER: 'x-aihub-client-ip',
  OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', UPSTREAM_API_KEY: '',
  DEEPSEEK_API_KEY: `fixture-${randomBytes(32).toString('hex')}`,
  DEEPSEEK_BASE_URL: 'http://127.0.0.1:3199/v1', DEEPSEEK_TIMEOUT_MS: '3000', ROUTER_MAX_RETRIES: '0',
  PYTHON_TEST_EXECUTABLE: '/opt/token-depot-sdk/bin/python3', PYTHONPATH: '',
  PYTHON_TEST_PATH: '/opt/token-depot-sdk/lib/python3.11/site-packages',
};
const env = values => Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n';
for (const [file, contents] of Object.entries({ 'db-password': password, 'redis-password': redisPassword,
  'app.env': env(shared), 'suite.env': env({ ...shared, DATABASE_URL: database.replace('/aihub_auth_test', '/aihub') }) })) {
  writeFileSync(resolve(directory, 'secrets', file), contents, { mode: 0o600, flag: 'wx' });
}
writeFileSync(resolve(directory, 'preflight.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
  project: 'td-reliability-20261016', freshSecrets: true, loadedRealCredentials: false,
  database: 'aihub_auth_test on a NEW named volume', externalBackupAuthorized: false,
  rateLimits: 'unchanged production defaults', publicPayments: false, paidProviders: false }, null, 2));
console.log('Created new isolated fixture files; values suppressed. Tighten Windows ACLs before starting containers.');
