// Read-only, offline pre-launch configuration checks. Never load implicit .env,
// connect to a database/provider, execute migration, or print configuration values.
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';

const composeFields = ['SITE_DOMAIN', 'API_DOMAIN', 'ACME_EMAIL', 'APP_IMAGE', 'TOOLS_IMAGE', 'CADDY_IMAGE', 'APP_SECRET_FILE', 'DB_PASSWORD_FILE', 'APP_DB_PASSWORD_FILE', 'REDIS_PASSWORD_FILE', 'PAYMENT_KEYS_DIR'];
const appFields = ['NODE_ENV', 'DATABASE_URL', 'APP_ORIGIN', 'DATABASE_POOL_MAX', 'DATABASE_POOL_TIMEOUT_MS', 'DATABASE_POOL_IDLE_MS', 'DATABASE_POOL_LIFETIME_SECONDS', 'REDIS_URL', 'REDIS_NAMESPACE', 'IP_HASH_SECRET', 'TRUSTED_IP_HEADER', 'SEO_INDEXING_ENABLED', 'SITE_OPERATOR_NAME', 'SITE_CONTACT_EMAIL', 'PAYMENTS_ENABLED', 'PAYMENT_NOTIFY_ORIGIN', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_TIMEOUT_MS', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'ALIPAY_APP_ID', 'ALIPAY_SELLER_ID', 'ALIPAY_PRIVATE_KEY_PATH', 'ALIPAY_PUBLIC_KEY_PATH', 'WECHAT_APP_ID', 'WECHAT_MCH_ID', 'WECHAT_CERT_SERIAL', 'WECHAT_PRIVATE_KEY_PATH', 'WECHAT_PUBLIC_KEY_ID', 'WECHAT_PUBLIC_KEY_PATH', 'WECHAT_API_V3_KEY_PATH'];
const placeholder = value => /REPLACE|yourdomain|example\.(?:com|net|org)|\.example(?:$|[/:])|build\.invalid/i.test(value ?? '');
const hexSecret = value => /^[a-f\d]{64}$/i.test(value ?? '') && !/^(.)\1+$/.test(value);
const host = value => typeof value === 'string' && value.length <= 253 && !isIP(value) && !placeholder(value)
  && /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(value);

export function parseEnvironment(text) {
  const result = Object.create(null);
  for (const source of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z\d_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1])) throw new Error('INVALID_OR_DUPLICATE_ENV_ENTRY');
    let value = match[2].trim();
    if (/^["']/.test(value)) {
      if (value.length < 2 || value.at(-1) !== value[0]) throw new Error('INVALID_ENV_QUOTING');
      value = value.slice(1, -1);
    }
    if (/[\x00-\x1f]/.test(value) || /\$\{|\$\(/.test(value)) throw new Error('UNRESOLVED_ENV_VALUE');
    result[match[1]] = value;
  }
  return result;
}

export function checkPrelaunchConfiguration(compose, app, secrets) {
  const issues = [];
  const issue = (field, code) => issues.push({ field, code });
  for (const [object, fields] of [[compose, composeFields], [app, appFields]]) {
    for (const field of fields) if (!Object.hasOwn(object, field)) issue(field, 'MISSING_VARIABLE');
  }
  if (!host(compose.SITE_DOMAIN)) issue('SITE_DOMAIN', 'REAL_DOMAIN_REQUIRED');
  if (!host(compose.API_DOMAIN) || compose.API_DOMAIN !== `api.${compose.SITE_DOMAIN}`) issue('API_DOMAIN', 'API_SUBDOMAIN_MISMATCH');
  for (const field of ['ACME_EMAIL']) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compose[field] ?? '') || placeholder(compose[field])) issue(field, 'REAL_CONTACT_REQUIRED');
  for (const field of ['APP_IMAGE', 'TOOLS_IMAGE', 'CADDY_IMAGE']) {
    if (!/^[a-z\d][a-z\d./:_-]*@sha256:[a-f\d]{64}$/.test(compose[field] ?? '') || placeholder(compose[field]) || /:latest@/.test(compose[field])) issue(field, 'REVIEWED_IMAGE_DIGEST_REQUIRED');
  }
  for (const field of ['APP_SECRET_FILE', 'DB_PASSWORD_FILE', 'APP_DB_PASSWORD_FILE', 'REDIS_PASSWORD_FILE', 'PAYMENT_KEYS_DIR']) {
    if (!compose[field] || placeholder(compose[field])) issue(field, 'EXPLICIT_SECRET_PATH_REQUIRED');
  }
  if (new Set(['APP_SECRET_FILE', 'DB_PASSWORD_FILE', 'APP_DB_PASSWORD_FILE', 'REDIS_PASSWORD_FILE'].map(field => compose[field])).size !== 4) issue('SECRET_PATHS', 'SECRET_PATHS_MUST_DIFFER');
  if (app.NODE_ENV !== 'production') issue('NODE_ENV', 'PRODUCTION_REQUIRED');
  if (app.APP_ORIGIN !== `https://${compose.SITE_DOMAIN}`) issue('APP_ORIGIN', 'HTTPS_SITE_ORIGIN_REQUIRED');
  if (app.PAYMENT_NOTIFY_ORIGIN !== app.APP_ORIGIN) issue('PAYMENT_NOTIFY_ORIGIN', 'MAIN_SITE_ORIGIN_REQUIRED');
  if (app.PAYMENTS_ENABLED !== 'false') issue('PAYMENTS_ENABLED', 'PRELAUNCH_PAYMENTS_MUST_STAY_OFF');
  if (app.SEO_INDEXING_ENABLED !== 'false') issue('SEO_INDEXING_ENABLED', 'PRELAUNCH_NOINDEX_REQUIRED');
  if (!app.SITE_OPERATOR_NAME || placeholder(app.SITE_OPERATOR_NAME)) issue('SITE_OPERATOR_NAME', 'REAL_OPERATOR_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(app.SITE_CONTACT_EMAIL ?? '') || placeholder(app.SITE_CONTACT_EMAIL)) issue('SITE_CONTACT_EMAIL', 'REAL_CONTACT_REQUIRED');
  if (app.TRUSTED_IP_HEADER !== 'x-aihub-client-ip') issue('TRUSTED_IP_HEADER', 'CADDY_HEADER_MISMATCH');
  if (!/^[a-z\d:_-]{1,64}$/i.test(app.REDIS_NAMESPACE ?? '')) issue('REDIS_NAMESPACE', 'NAMESPACE_REQUIRED');
  let database, redis;
  try {
    database = new URL(app.DATABASE_URL);
    if (database.protocol !== 'postgresql:' || database.username !== 'aihub' || database.hostname !== 'postgres' || !['', '5432'].includes(database.port)
      || database.pathname !== '/aihub' || database.hash || database.search !== '?schema=public' || !hexSecret(database.password)) issue('DATABASE_URL', 'PRIVATE_APP_DATABASE_REQUIRED');
  } catch { issue('DATABASE_URL', 'INVALID_URL'); }
  try {
    redis = new URL(app.REDIS_URL);
    if (redis.protocol !== 'redis:' || redis.username || redis.hostname !== '127.0.0.1' || !['', '6379'].includes(redis.port) || redis.pathname !== '/0' || redis.search || redis.hash || !hexSecret(redis.password)) issue('REDIS_URL', 'AUTHENTICATED_LOOPBACK_REDIS_REQUIRED');
  } catch { issue('REDIS_URL', 'INVALID_URL'); }
  if (!hexSecret(app.IP_HASH_SECRET)) issue('IP_HASH_SECRET', 'INDEPENDENT_RANDOM_SECRET_REQUIRED');
  for (const [field, min, max] of [['DATABASE_POOL_MAX', 1, 10], ['DATABASE_POOL_TIMEOUT_MS', 1, 60000], ['DATABASE_POOL_IDLE_MS', 1, 600000], ['DATABASE_POOL_LIFETIME_SECONDS', 1, 86400], ['DEEPSEEK_TIMEOUT_MS', 1000, 120000]]) {
    if (!/^\d+$/.test(app[field] ?? '') || Number(app[field]) < min || Number(app[field]) > max) issue(field, 'PRELAUNCH_BOUNDS_EXCEEDED');
  }
  if (app.DEEPSEEK_BASE_URL !== 'https://api.deepseek.com') issue('DEEPSEEK_BASE_URL', 'OFFICIAL_ORIGIN_REQUIRED');
  for (const field of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) {
    if (app[field]) issue(field, 'PRELAUNCH_PROVIDER_CREDENTIAL_MUST_STAY_UNSET');
  }
  if (Object.keys(app).some(key => /(?:_TEST|_TESTS)$|^MOCK_|^PYTHON_TEST_|^TD_(?:COMMERCIAL|RELIABILITY)_/.test(key))) issue('TEST_CONFIGURATION', 'TEST_VARIABLE_FORBIDDEN');
  if (Object.keys(app).some(key => /^NEXT_PUBLIC_.*(?:KEY|TOKEN|SECRET|PASSWORD)/.test(key))) issue('NEXT_PUBLIC_*', 'PUBLIC_SECRET_FORBIDDEN');
  const unique = [database?.password, redis?.password, app.IP_HASH_SECRET].filter(Boolean);
  if (secrets) {
    if (!hexSecret(secrets.admin) || !hexSecret(secrets.app) || !hexSecret(secrets.redis)) issue('SECRET_FILES', 'RANDOM_SECRET_FORMAT_REQUIRED');
    if (database?.password !== secrets.app) issue('DATABASE_URL', 'APP_PASSWORD_MISMATCH');
    if (redis?.password !== secrets.redis) issue('REDIS_URL', 'PASSWORD_MISMATCH');
    unique.push(secrets.admin);
  }
  if (new Set(unique).size !== unique.length) issue('SECRET_FILES', 'SECRETS_MUST_BE_INDEPENDENT');
  return { configurationValid: issues.length === 0, phase: 'offline-prelaunch', commercialLaunchApproved: false, issues,
    unverified: ['target-host-and-network', 'image-provenance-and-CVE', 'DNS-and-public-TLS', 'offsite-recovery', 'merchant-and-provider-authorization', 'actual-provider-cost', 'operator-qualifications'] };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--templates') {
    const compose = parseEnvironment(readFileSync('.env.production.example', 'utf8'));
    const app = parseEnvironment(readFileSync('deploy/app.env.example', 'utf8'));
    const structure = composeFields.every(field => Object.hasOwn(compose, field)) && appFields.every(field => Object.hasOwn(app, field));
    const defaults = app.NODE_ENV === 'production' && app.PAYMENTS_ENABLED === 'false' && app.SEO_INDEXING_ENABLED === 'false'
      && ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'].every(field => app[field] === '')
      && app.APP_ORIGIN === `https://${compose.SITE_DOMAIN}` && app.PAYMENT_NOTIFY_ORIGIN === app.APP_ORIGIN;
    console.log(JSON.stringify({ templateStructureValid: structure, safeDefaults: defaults, ...checkPrelaunchConfiguration(compose, app), secretFilesRead: false }, null, 2));
    if (!structure || !defaults) process.exitCode = 1;
    return;
  }
  if (args.length !== 4 || args[0] !== '--compose-env' || args[2] !== '--app-env') throw new Error('EXPLICIT_CONFIG_PATHS_REQUIRED');
  const root = dirname(resolve(args[1]));
  const compose = parseEnvironment(readFileSync(args[1], 'utf8'));
  const app = parseEnvironment(readFileSync(args[3], 'utf8'));
  if (realpathSync(resolve(root, compose.APP_SECRET_FILE)) !== realpathSync(args[3])) throw new Error('APP_SECRET_FILE_PATH_MISMATCH');
  const files = { admin: resolve(root, compose.DB_PASSWORD_FILE), app: resolve(root, compose.APP_DB_PASSWORD_FILE), redis: resolve(root, compose.REDIS_PASSWORD_FILE) };
  const secrets = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(path, 'utf8').trim()]));
  const result = checkPrelaunchConfiguration(compose, app, secrets);
  if (process.platform !== 'win32') {
    for (const [key, path] of Object.entries({ ...files, app_env: args[3] })) {
      const info = statSync(path);
      const owner = { admin: 999, app: 999, redis: 0, app_env: 1000 }[key];
      if (!info.isFile() || ![0o400, 0o600].includes(info.mode & 0o777) || info.uid !== owner) result.issues.push({ field: 'SECRET_FILE_PERMISSIONS', code: 'PINNED_IMAGE_OWNER_OR_MODE_MISMATCH' });
    }
    const parent = statSync(dirname(resolve(args[3])));
    if (parent.uid !== 0 || (parent.mode & 0o777) !== 0o700) result.issues.push({ field: 'SECRET_DIRECTORY', code: 'ROOT_ONLY_DIRECTORY_REQUIRED' });
  } else result.unverified.push('windows-secret-DACL-not-checked-by-this-command');
  result.configurationValid = result.issues.length === 0;
  console.log(JSON.stringify(result, null, 2));
  if (!result.configurationValid) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch { console.error(JSON.stringify({ configurationValid: false, code: 'CONFIGURATION_UNREADABLE_OR_INVALID', commercialLaunchApproved: false })); process.exitCode = 1; }
}
