import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Generates credentials for the isolated Docker acceptance project only.
// Never reuse these files for production or print their contents.
const root = process.cwd();
const secretDir = join(root, "deploy", "local-test-secrets");
const paymentDir = join(root, "deploy", "local-test-payment-keys");
const resultDir = join(root, "docker-test-results");
const envFile = join(root, ".env.docker-test");
const gatewayEnvFile = join(secretDir, "gateway-test.env");
const secretFiles = ["db-password", "app-db-password", "redis-password", "app.env", "gateway-test.env"];

const writeSecret = (name, value) => writeFileSync(join(secretDir, name), `${value}\n`, { flag: "wx", mode: 0o600 });
function writeGatewayEnv(appDbPassword) {
  writeSecret("gateway-test.env", [
    `DATABASE_URL=postgresql://aihub:${appDbPassword}@127.0.0.1:5432/aihub?schema=public`,
    `DATABASE_URL_TEST=postgresql://aihub:${appDbPassword}@127.0.0.1:5432/aihub_auth_test?schema=public`,
    "REDIS_URL=redis://127.0.0.1:6379/0",
    "REDIS_URL_TEST=redis://127.0.0.1:6379/15",
    "PAYMENTS_ENABLED=false",
    "SEO_INDEXING_ENABLED=false",
    "OPENAI_API_KEY=",
    "ANTHROPIC_API_KEY=",
    "GEMINI_API_KEY=",
    "DEEPSEEK_API_KEY=",
    "",
  ].join("\n"));
}

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--gateway-only")) {
  throw new Error("Usage: node scripts/prepare-local-docker-test.mjs [--gateway-only]");
}

if (process.argv[2] === "--gateway-only") {
  if (!existsSync(envFile) || !existsSync(join(secretDir, "app-db-password")) || !existsSync(join(secretDir, "app.env"))) {
    throw new Error("Generate the isolated Docker test credentials first.");
  }
  if (existsSync(gatewayEnvFile)) throw new Error("Gateway test credentials already exist; refusing to overwrite them.");
  const composeEnv = readFileSync(envFile, "utf8");
  const appEnv = readFileSync(join(secretDir, "app.env"), "utf8");
  const appDbPassword = readFileSync(join(secretDir, "app-db-password"), "utf8").trim();
  if (!composeEnv.includes("APP_SECRET_FILE=./deploy/local-test-secrets/app.env")
    || !composeEnv.includes("DB_PASSWORD_FILE=./deploy/local-test-secrets/db-password")
    || !composeEnv.includes("APP_DB_PASSWORD_FILE=./deploy/local-test-secrets/app-db-password")
    || !composeEnv.includes("REDIS_PASSWORD_FILE=./deploy/local-test-secrets/redis-password")
    || !/^[a-f0-9]{64}$/.test(appDbPassword)
    || !appEnv.includes(`DATABASE_URL=postgresql://aihub:${appDbPassword}@postgres:5432/aihub?schema=public`)
    || !appEnv.includes("APP_ORIGIN=https://localhost:8443")
    || !appEnv.includes("SEO_INDEXING_ENABLED=false")
    || !appEnv.includes("PAYMENTS_ENABLED=false")
    || !["OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK"].every((name) => appEnv.split(/\r?\n/).includes(`${name}_API_KEY=`))) {
    throw new Error("Existing Docker credentials are not an isolated, payment-disabled test configuration.");
  }
  writeGatewayEnv(appDbPassword);
  console.log("Created ignored, isolated Gateway Mock test credentials.");
} else {

  if (existsSync(envFile) || secretFiles.some((name) => existsSync(join(secretDir, name)))) {
    throw new Error("Local Docker test credentials already exist; refusing to overwrite them.");
  }

const randomHex = () => randomBytes(32).toString("hex");
const dbAdminPassword = randomHex();
const appDbPassword = randomHex();
const redisPassword = randomHex();
const ipHashSecret = randomHex();

mkdirSync(secretDir, { recursive: true });
mkdirSync(paymentDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });

writeSecret("db-password", dbAdminPassword);
writeSecret("app-db-password", appDbPassword);
writeSecret("redis-password", redisPassword);
writeSecret("app.env", [
  `DATABASE_URL=postgresql://aihub:${appDbPassword}@postgres:5432/aihub?schema=public`,
  "APP_ORIGIN=https://localhost:8443",
  "SEO_INDEXING_ENABLED=false",
  "DATABASE_POOL_MAX=5",
  `REDIS_URL=redis://:${redisPassword}@127.0.0.1:6379/0`,
  "REDIS_NAMESPACE=aihub-docker-test",
  `IP_HASH_SECRET=${ipHashSecret}`,
  "TRUSTED_IP_HEADER=x-aihub-client-ip",
  "DEEPSEEK_API_KEY=",
  "OPENAI_API_KEY=",
  "ANTHROPIC_API_KEY=",
  "GEMINI_API_KEY=",
  "PAYMENTS_ENABLED=false",
  "PAYMENT_NOTIFY_ORIGIN=https://localhost:8443",
  "",
].join("\n"));
writeGatewayEnv(appDbPassword);

writeFileSync(envFile, [
  "SITE_DOMAIN=local.invalid",
  "API_DOMAIN=api.local.invalid",
  "ACME_EMAIL=test@example.invalid",
  "APP_IMAGE=aihub-docker-test:local",
  "TOOLS_IMAGE=aihub-tools-docker-test:local",
  "TEST_TOOLS_IMAGE=aihub-test-tools-docker-test:local",
  "CADDY_IMAGE=token-depot-caddy-docker-test:local",
  "APP_SECRET_FILE=./deploy/local-test-secrets/app.env",
  "DB_PASSWORD_FILE=./deploy/local-test-secrets/db-password",
  "APP_DB_PASSWORD_FILE=./deploy/local-test-secrets/app-db-password",
  "REDIS_PASSWORD_FILE=./deploy/local-test-secrets/redis-password",
  "PAYMENT_KEYS_DIR=./deploy/local-test-payment-keys",
  "",
].join("\n"), { flag: "wx", mode: 0o600 });

console.log("Created isolated, ignored Docker test credentials and result directory.");
}
