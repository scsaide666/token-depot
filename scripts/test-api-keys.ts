import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { generateApiKey, hashApiKey, matchesApiKeyHash } from "../lib/server/api-key-crypto";

config({ quiet: true });
const risk = riskTestEnvironment("api-keys");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("Configure the isolated DATABASE_URL_TEST first.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test", "Tests require the local aihub_auth_test database.");
assert(databaseUrl !== process.env.DATABASE_URL, "Test and development databases must be separate.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 4 }), log: [] });
const origin = "http://127.0.0.1:3102";
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production" };
const seed = randomBytes(8).toString("hex");
const emails = [`keys-a-${seed}@example.test`, `keys-b-${seed}@example.test`];
const password = `Test-only-${randomBytes(16).toString("hex")}`;
const userIds: string[] = [];
const secrets: string[] = [];
const hashes: string[] = [];
let server: ChildProcess | undefined;
let passed = 0;

async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  return fetch(`${origin}${path}`, { method: options.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.method ? { Origin: origin, "Content-Type": "application/json" } : {}), ...options.headers }, ...(options.method ? { body: JSON.stringify(options.body ?? {}) } : {}) });
}
function safe(value: unknown) {
  const text = JSON.stringify(value);
  assert(!text.includes("keyHash") && !text.includes("passwordHash") && !text.includes("tokenHash"), "Responses must exclude private hashes.");
  assert(secrets.every((secret) => !text.includes(secret)) && hashes.every((hash) => !text.includes(hash)), "Metadata responses must not contain a full key or its hash.");
}
async function json(response: Response, status: number, creation = false) {
  assert.equal(response.status, status, "Unexpected API response status.");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  if (creation) safe(result.apiKey); else safe(result);
  return result;
}
async function check(name: string, action: () => Promise<void>) { await action(); passed++; console.log(`PASS ${name}`); }
async function register(email: string) {
  const response = await request("/api/auth/register", { method: "POST", body: { name: "API Key Test", email, password, confirmPassword: password } });
  const { user } = await json(response, 201); userIds.push(user.id);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-aihub-session="))?.split(";")[0];
  assert(cookie, "Registration must create a session.");
  return { id: user.id as string, cookie };
}
async function create(cookie: string, name: string) {
  const result = await json(await request("/api/api-keys", { method: "POST", cookie, body: { name } }), 201, true);
  assert(/^sk-aihub-[A-Za-z0-9_-]{43}$/.test(result.key), "Key must have 256-bit random material in the expected format.");
  assert.equal(result.apiKey.keyPrefix, result.key.slice(0, 13));
  secrets.push(result.key); hashes.push(hashApiKey(result.key));
  return { id: result.apiKey.id as string, key: result.key as string, metadata: result.apiKey };
}
async function list(cookie: string, query = "") {
  return (await json(await request(`/api/api-keys${query}`, { cookie }), 200)).apiKeys;
}

async function main() {
  assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Test port 3102 must be free.");
  try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" }); }
  catch { throw new Error("API Key test database migration failed."); }
  const processHandle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3102"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server = processHandle;
  processHandle.stdout?.on("data", () => {}); processHandle.stderr?.on("data", () => {});
  let startupError = false;
  processHandle.on("error", () => { startupError = true; });
  const deadline = Date.now() + 30000;
  while (!await request("/api/auth/session").then((response) => response.status === 200).catch(() => false)) {
    if (startupError || processHandle.exitCode !== null || Date.now() > deadline) throw new Error("API Key test server failed to start. Run build first.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const a = await register(emails[0]); const b = await register(emails[1]);
  let aKey: Awaited<ReturnType<typeof create>>;
  const bKey = await create(b.cookie, "User B Key");

  await check("Anonymous users cannot list, create, rename, revoke or delete keys", async () => {
    await json(await request("/api/api-keys"), 401);
    await json(await request("/api/api-keys", { method: "POST", body: { name: "No session" } }), 401);
    await json(await request(`/api/api-keys/${bKey.id}`, { method: "PATCH", body: { name: "No session" } }), 401);
    await json(await request(`/api/api-keys/${bKey.id}/revoke`, { method: "POST" }), 401);
    await json(await request(`/api/api-keys/${bKey.id}`, { method: "DELETE" }), 401);
  });
  await check("Server validation rejects blank names, extra fields and foreign origins", async () => {
    for (const body of [{ name: " " }, { name: "x".repeat(65) }, { name: "Invalid", userId: b.id }, { name: "Invalid", keyHash: "a".repeat(64) }, { name: "Invalid", expiresAt: new Date().toISOString() }]) {
      await json(await request("/api/api-keys", { method: "POST", cookie: a.cookie, body }), 422);
    }
    await json(await request("/api/api-keys", { method: "POST", cookie: a.cookie, body: { name: "CSRF" }, headers: { Origin: "https://foreign.example" } }), 403);
    await json(await request("/api/api-keys", { method: "POST", cookie: a.cookie, body: { name: "CSRF" }, headers: { "Sec-Fetch-Site": "cross-site" } }), 403);
    await json(await request("/api/api-keys", { method: "POST", cookie: a.cookie, body: { name: "Invalid" }, headers: { "Content-Type": "text/plain" } }), 415);
    assert.equal((await list(a.cookie)).length, 0);
  });
  await check("Creation persists only a hash and prefix, with Last Used reserved", async () => {
    aKey = await create(a.cookie, "  Production  ");
    assert.equal(aKey.metadata.name, "Production"); assert.equal(aKey.metadata.status, "active");
    assert.equal(aKey.metadata.lastUsedAt, null); assert.equal(aKey.metadata.expiresAt, null); assert.equal(aKey.metadata.revokedAt, null);
    const stored = await db.apiKey.findUniqueOrThrow({ where: { id: aKey.id } });
    assert.equal(stored.userId, a.id); assert(stored.keyHash === hashApiKey(aKey.key), "Database must store the SHA-256 digest.");
    assert(!JSON.stringify(stored).includes(aKey.key), "No full secret may be stored in the record.");
    const columns = await db.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'ApiKey'`;
    assert.deepEqual(columns.map((column) => column.column_name).sort(), ["id", "userId", "name", "keyPrefix", "keyHash", "lastUsedAt", "expiresAt", "revokedAt", "createdAt", "updatedAt"].sort());
  });
  await check("Keys are unpredictable and comparison safely handles invalid inputs", async () => {
    const values = Array.from({ length: 100 }, () => generateApiKey());
    assert.equal(new Set(values.map((value) => value.key)).size, 100);
    assert(values.every((value) => matchesApiKeyHash(value.key, value.keyHash)));
    assert(!matchesApiKeyHash(values[0].key, values[1].keyHash));
    assert(!matchesApiKeyHash(aKey.key, "short")); assert(!matchesApiKeyHash("malformed", hashApiKey(aKey.key)));
  });
  await check("Refresh and repeated list reads never return the complete key", async () => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const records = await list(a.cookie); assert.equal(records.length, 1); assert.equal(records[0].id, aKey.id); assert(!("key" in records[0])); assert(!("userId" in records[0]));
    }
    const page = await request("/dashboard/api-keys", { cookie: a.cookie }); assert.equal(page.status, 200); safe(await page.text());
    assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: aKey.id } })).lastUsedAt, null);
    const detail = await request(`/api/api-keys/${aKey.id}`, { cookie: a.cookie }); assert.equal(detail.status, 405);
  });
  await check("Users list only their keys; userId in query cannot change ownership", async () => {
    const aRecords = await list(a.cookie, `?userId=${b.id}`); assert.equal(aRecords.length, 1); assert.equal(aRecords[0].id, aKey.id);
    const bRecords = await list(b.cookie); assert.equal(bRecords.length, 1); assert.equal(bRecords[0].id, bKey.id);
  });
  await check("User A cannot rename, revoke or delete User B's key", async () => {
    const missing = await json(await request(`/api/api-keys/${randomUUID()}`, { method: "PATCH", cookie: a.cookie, body: { name: "Missing" } }), 404);
    const foreign = await json(await request(`/api/api-keys/${bKey.id}`, { method: "PATCH", cookie: a.cookie, body: { name: "Hijacked" } }), 404); assert.equal(missing.error, foreign.error);
    await json(await request(`/api/api-keys/${bKey.id}/revoke`, { method: "POST", cookie: a.cookie }), 404);
    await json(await request(`/api/api-keys/${bKey.id}`, { method: "DELETE", cookie: a.cookie }), 404);
    await db.user.update({ where: { id: a.id }, data: { role: "ADMIN" } });
    await json(await request(`/api/api-keys/${bKey.id}`, { method: "DELETE", cookie: a.cookie }), 404);
    await db.user.update({ where: { id: a.id }, data: { role: "USER" } });
    const record = await db.apiKey.findUniqueOrThrow({ where: { id: bKey.id } }); assert.equal(record.name, "User B Key"); assert.equal(record.revokedAt, null);
  });
  await check("Rename persists and cannot change userId, hash or lifecycle fields", async () => {
    const response = await json(await request(`/api/api-keys/${aKey.id}`, { method: "PATCH", cookie: a.cookie, body: { name: "  Cursor  " } }), 200);
    assert.equal(response.apiKey.name, "Cursor"); assert.equal((await list(a.cookie))[0].name, "Cursor");
    for (const extra of [{ userId: b.id }, { keyHash: "a".repeat(64) }, { revokedAt: null }, { expiresAt: new Date().toISOString() }]) {
      await json(await request(`/api/api-keys/${aKey.id}`, { method: "PATCH", cookie: a.cookie, body: { name: "Invalid", ...extra } }), 422);
    }
    const stored = await db.apiKey.findUniqueOrThrow({ where: { id: aKey.id } }); assert.equal(stored.name, "Cursor"); assert(stored.keyHash === hashApiKey(aKey.key)); assert.equal(stored.lastUsedAt, null);
  });
  await check("Revoke persists Revoked status and is idempotent", async () => {
    await json(await request(`/api/api-keys/${aKey.id}/revoke`, { method: "POST", cookie: a.cookie, body: { userId: b.id } }), 422);
    const first = await json(await request(`/api/api-keys/${aKey.id}/revoke`, { method: "POST", cookie: a.cookie }), 200);
    assert.equal(first.apiKey.status, "revoked"); assert(first.apiKey.revokedAt);
    const second = await json(await request(`/api/api-keys/${aKey.id}/revoke`, { method: "POST", cookie: a.cookie }), 200);
    assert.equal(second.apiKey.revokedAt, first.apiKey.revokedAt);
    assert.equal((await list(a.cookie))[0].status, "revoked");
  });
  await check("Expiry produces Expired; revocation takes precedence", async () => {
    const expired = await create(a.cookie, "Expired fixture");
    await db.apiKey.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await list(a.cookie)).find((record: { id: string }) => record.id === expired.id).status, "expired");
    const revoked = await json(await request(`/api/api-keys/${expired.id}/revoke`, { method: "POST", cookie: a.cookie }), 200); assert.equal(revoked.apiKey.status, "revoked");
    await json(await request(`/api/api-keys/${expired.id}`, { method: "DELETE", cookie: a.cookie }), 200);
  });
  await check("Suspended sessions cannot manage keys", async () => {
    await db.user.update({ where: { id: a.id }, data: { status: "SUSPENDED" } });
    await json(await request("/api/api-keys", { cookie: a.cookie }), 401);
    await json(await request(`/api/api-keys/${aKey.id}`, { method: "DELETE", cookie: a.cookie }), 401);
    await db.user.update({ where: { id: a.id }, data: { status: "ACTIVE" } });
  });
  await check("Delete removes only the owned key and returns the empty list", async () => {
    await json(await request(`/api/api-keys/${aKey.id}`, { method: "DELETE", cookie: a.cookie, body: { userId: b.id } }), 422);
    await json(await request(`/api/api-keys/${aKey.id}`, { method: "DELETE", cookie: a.cookie }), 200);
    assert.equal(await db.apiKey.count({ where: { id: aKey.id } }), 0); assert.equal((await list(a.cookie)).length, 0);
    assert.equal((await list(b.cookie)).length, 1);
    await json(await request(`/api/api-keys/${aKey.id}`, { method: "PATCH", cookie: a.cookie, body: { name: "Deleted" } }), 404);
    await json(await request(`/api/api-keys/${aKey.id}/revoke`, { method: "POST", cookie: a.cookie }), 404);
    await json(await request(`/api/api-keys/${aKey.id}`, { method: "DELETE", cookie: a.cookie }), 404);
  });
  console.log(`API Key integration checks: ${passed} passed. No secrets printed.`);
}

async function run() {
  try { await main(); }
  catch (error) { console.error(`FAIL ${error instanceof Error ? error.message : "API Key test failed."}`); process.exitCode = 1; }
  finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    await db.user.deleteMany({ where: { id: { in: userIds }, email: { in: emails } } }).catch(() => { console.error("API Key test fixture cleanup failed."); process.exitCode = 1; });
    const keys = emails.flatMap((email) => ["register", "login"].map((action) => createHash("sha256").update(`${action}:${email}`).digest("hex")));
    await db.authRateLimit.deleteMany({ where: { key: { in: keys } } }).catch(() => { console.error("Test rate-limit cleanup failed."); process.exitCode = 1; });
    await risk.cleanup();
    await db.$disconnect();
  }
}
void run().catch(() => { console.error("API Key test cleanup failed."); process.exitCode = 1; });
