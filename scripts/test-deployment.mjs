import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(name, "utf8");
const compose = (...extra) => JSON.parse(execFileSync("docker", ["compose", "--env-file", ".env.production.example", ...extra, "config", "--format", "json"], { encoding: "utf8", windowsHide: true }));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const defaultConfig = compose(), full = compose("--profile", "public", "--profile", "ops");
const local = JSON.parse(execFileSync("docker", ["compose", "-f", "compose.yaml", "-f", "compose.local-test.yaml", "--env-file", ".env.production.example", "--profile", "local-https", "config", "--format", "json"], { encoding: "utf8", windowsHide: true }));
check("default deployment publishes no host ports or public proxy", () => {
  assert(!defaultConfig.services.caddy);
  for (const service of Object.values(defaultConfig.services)) assert(!service.ports?.length);
});
check("only public Caddy exposes HTTP/HTTPS; database network is internal", () => {
  assert.deepEqual(full.services.caddy.ports.map(p => Number(p.published)).sort((a,b)=>a-b), [80,443]);
  assert.equal(full.networks.database.internal, true);
  assert(!full.services.postgres.ports);
  assert.equal(full.services.redis.network_mode, "service:app");
});
check("runtime credentials are mounted secrets, not image build arguments", () => {
  assert(full.services.app.secrets.some(s=>s.source === "app_env"));
  assert(!full.services.app.environment);
  assert(read(".dockerignore").includes(".env*"));
  assert(read(".dockerignore").includes("deploy/secrets"));
  assert(read(".dockerignore").includes("deploy/payment-keys"));
  assert(read(".dockerignore").includes("deploy/local-test-secrets"));
  assert(read(".gitignore").includes("deploy/local-test-secrets/"));
  assert(read(".dockerignore").includes("docker-test-results"));
  assert(!read("Dockerfile").includes("COPY .env"));
  assert(read("Dockerfile").includes('USER node'));
});
check("sensitive operations retain fail-closed Redis; noeviction and localhost binding", () => {
  assert(full.services.redis.command[0].includes("bind 127.0.0.1"));
  assert(full.services.redis.command[0].includes("maxmemory-policy noeviction"));
  assert(full.services.redis.command[0].includes("requirepass"));
  assert(full.services.redis.command[0].includes("exec /usr/local/bin/docker-entrypoint.sh redis-server"));
  assert(full.services.redis.security_opt.includes("no-new-privileges:true"));
});
check("SSE proxy preserves disconnect behavior and overwrites client IP", () => {
  const caddy = read("Caddyfile").split("\n").filter(line=>!line.trim().startsWith("#")).join("\n");
  assert(!caddy.includes("flush_interval -1"));
  assert(caddy.includes("header_up X-AIHub-Client-IP {remote_host}"));
  assert(caddy.includes("@api path /v1/*"));
  assert(!caddy.includes("log {"));
});
check("payments and indexing remain disabled and overseas credentials are blank", () => {
  const env = read("deploy/app.env.example");
  for (const key of ["PAYMENTS_ENABLED", "SEO_INDEXING_ENABLED"]) assert(env.includes(`${key}=false`));
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) assert(env.split("\n").includes(`${key}=`));
  assert(!env.includes("AIHUB_LOCAL_PROVIDER_TESTS="));
});
check("backup uses transactional dump, safe temporary rename, limited retention", () => {
  const backup = read("deploy/backup.sh");
  assert(backup.includes("set -eu"));
  assert(backup.includes("pg_dump -U aihub_admin -d aihub -Fc"));
  assert(backup.includes('tmp=$(mktemp "backups/.aihub-$stamp.XXXXXX.tmp")'));
  assert(backup.includes('trap \'rm -f "$tmp"\' 0'));
  assert(backup.includes('pg_restore --list'));
  assert(backup.includes('/backup-crypto.mjs encrypt'));
  assert(backup.includes('BACKUP_KEY_FILE:?'));
  assert(backup.includes('Backup key must be separate from backups.'));
  assert(backup.includes('sha256sum "$file"'));
  assert(backup.includes('sh deploy/compose-production.sh'));
  assert(backup.includes("-maxdepth 1"));
});
check("all persistent daemons restart automatically and have bounded log size", () => {
  for (const name of ["app","postgres","redis","recovery","caddy"]) {
    const service = full.services[name];
    assert.equal(service.restart,"unless-stopped");
    assert.equal(service.logging.options["max-size"],"10m");
    assert(service.mem_limit > 0);
  }
  assert(full.services.caddy.healthcheck);
  assert(read("Caddyfile").includes("http://127.0.0.1:2015"));
});
check("application DB role cannot administer PostgreSQL roles or create databases", () => {
  assert.equal(full.services.postgres.environment.POSTGRES_USER, "aihub_admin");
  assert(read("deploy/init-database.sh").includes("NOSUPERUSER NOCREATEDB NOCREATEROLE"));
  assert(read("deploy/app.env.example").includes("postgresql://aihub:"));
});
check("isolated local HTTPS proxy binds loopback only and uses an internal CA", () => {
  assert.equal(local.name, "aihub-docker-test");
  assert(!local.services.caddy);
  assert.deepEqual(local.services["caddy-local"].ports.map(port => ({ host: port.host_ip, port: Number(port.published) })), [{ host: "127.0.0.1", port: 8443 }]);
  assert(!local.services.postgres.ports);
  assert(!local.services.redis.ports);
  assert(read("deploy/Caddyfile.local-test").includes("tls internal"));
});
console.log(`${passed} deployment configuration checks passed (no container runtime assertions).`);
