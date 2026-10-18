import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

config({ quiet: true });
const risk = riskTestEnvironment("auth");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("Configure DATABASE_URL_TEST for the isolated aihub_auth_test database.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test", "Tests only run on the local aihub_auth_test database.");
assert(databaseUrl !== process.env.DATABASE_URL, "Test and development databases must be separate.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 4 }), log: [] });
const origin = "http://127.0.0.1:3101";
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production" };
const seed = randomBytes(8).toString("hex");
const email = `auth-test-${seed}@example.test`;
const otherEmail = `auth-other-${seed}@example.test`;
const unknownEmail = `auth-unknown-${seed}@example.test`;
const throttleEmail = `auth-throttle-${seed}@example.test`;
const password = `Test-only-${randomBytes(16).toString("hex")}`;
const emails = [email, otherEmail, unknownEmail, throttleEmail];
const rateKeys = emails.flatMap((value) => ["login", "register"].map((action) => createHash("sha256").update(`${action}:${value}`).digest("hex")));
const userIds: string[] = [];
let server: ChildProcess | undefined;
let passed = 0;

const hashToken = (cookie: string) => createHash("sha256").update(cookie.slice(cookie.indexOf("=") + 1)).digest("hex");
function cookieOf(response: Response) {
  const value = response.headers.getSetCookie().find((value) => value.startsWith("__Host-aihub-session="));
  assert(value, "Authentication must issue its session cookie.");
  return value.split(";")[0];
}
function safe(value: unknown) {
  const json = JSON.stringify(value);
  assert(!json.includes("passwordHash") && !json.includes("tokenHash") && !json.includes(password), "Responses must exclude authentication secrets.");
}
async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: string } = {}) {
  return fetch(`${origin}${path}`, { method: options.method ?? "GET", redirect: "manual", headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.method ? { "Content-Type": "application/json", Origin: origin } : {}), ...options.headers }, ...(options.method ? { body: options.raw ?? JSON.stringify(options.body ?? {}) } : {}), signal: AbortSignal.timeout(15000) });
}
async function json(response: Response, status: number) {
  assert.equal(response.status, status, "Unexpected response status.");
  assert.equal(response.headers.get("cache-control"), "no-store", "Account responses must never be cached.");
  const result = await response.json();
  safe(result);
  return result;
}
async function deniedAdmin(path: string, cookie: string, headers?: Record<string, string>) {
  const response = await request(path, { cookie, headers });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text(); safe(text);
  assert(text.includes("Administrator access is required.") && !text.includes("Demo workspace"));
}
async function redirected(path: string, location: string, cookie?: string, headers?: Record<string, string>) {
  let response = await request(path, { cookie, headers });
  // Next canonicalizes RSC prefetch URLs before rendering the guarded route.
  for (let attempt = 0; attempt < 3 && response.status === 307 && response.headers.get("location")?.startsWith(`${path}?_rsc`); attempt++) {
    response = await request(response.headers.get("location")!, { cookie, headers });
  }
  const html = await response.text();
  const destination = response.headers.get("location");
  const emptyPrefetch = headers?.["Next-Router-Prefetch"] === "1" && response.status === 200 && html.includes("[null,null]");
  assert(emptyPrefetch || destination === location || (response.status === 200 && (html.includes(`url=${location}`) || html.includes(`NEXT_REDIRECT;replace;${location};`))), `${path} must redirect to ${location} on the server.`);
  assert(!html.includes("Monitor your usage, balance and API activity.") && !html.includes("Requests Today"), "Unauthorized responses must not render protected content.");
  safe(html);
}
async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }
async function login(rememberMe = false, cookie?: string) {
  const response = await request("/api/auth/login", { method: "POST", cookie, body: { email, password, rememberMe } });
  const result = await json(response, 200);
  return { cookie: cookieOf(response), response, user: result.user };
}

async function main() {
  assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Port 3101 is already in use; tests refused to use an unknown server.");
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" });
  } catch { throw new Error("Isolated test database migration failed."); }
  const testServer = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3101"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server = testServer;
  // Drain output without exposing request bodies or database configuration.
  testServer.stdout?.on("data", () => {}); testServer.stderr?.on("data", () => {});
  let startupError = false;
  testServer.on("error", () => { startupError = true; });
  const deadline = Date.now() + 30000;
  while (true) {
    if (startupError || testServer.exitCode !== null) throw new Error("Authentication test server could not start. Run npm run build first.");
    const ready = await request("/api/auth/session").then((response) => response.status === 200).catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) throw new Error("Authentication test server did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  let cookie = "";
  let userId = "";
  let otherId = "";
  let otherCookie = "";
  const dashboardPaths = ["/dashboard", "/dashboard/api-keys", "/dashboard/usage", "/dashboard/models", "/dashboard/billing", "/dashboard/settings"];
  const adminPaths = ["/admin", "/admin/users", "/admin/models", "/admin/requests", "/admin/payments"];

  await check("Anonymous session and all Dashboard/Admin routes", async () => {
    assert.equal((await json(await request("/api/auth/session"), 200)).user, null);
    await json(await request("/api/profile"), 401);
    await json(await request("/api/profile", { method: "PATCH", body: { name: "Unauthorized" } }), 401);
    for (const path of [...dashboardPaths, ...adminPaths]) await redirected(path, "/login");
    await redirected("/dashboard/settings", "/login", undefined, { RSC: "1" });
    await redirected("/dashboard/settings", "/login", undefined, { RSC: "1", "Next-Router-Prefetch": "1" });
  });
  await check("Server validation, CSRF origin, content type and body limits", async () => {
    const valid = { name: " Test User ", email, password, confirmPassword: password };
    await json(await request("/api/auth/register", { method: "POST", body: { ...valid, confirmPassword: "mismatch" } }), 422);
    await json(await request("/api/auth/register", { method: "POST", body: { ...valid, password: "short", confirmPassword: "short" } }), 422);
    await json(await request("/api/auth/register", { method: "POST", body: { ...valid, role: "ADMIN" } }), 422);
    await json(await request("/api/auth/register", { method: "POST", body: { ...valid, email: "invalid" } }), 422);
    await json(await request("/api/auth/register", { method: "POST", body: { ...valid, password: "a".repeat(129), confirmPassword: "a".repeat(129) } }), 422);
    await json(await request("/api/auth/register", { method: "POST", body: valid, headers: { Origin: "https://foreign.example" } }), 403);
    await json(await request("/api/auth/register", { method: "POST", body: valid, headers: { "Sec-Fetch-Site": "cross-site" } }), 403);
    await json(await request("/api/auth/register", { method: "POST", body: valid, headers: { "Content-Type": "text/plain" } }), 415);
    await json(await request("/api/auth/register", { method: "POST", raw: "{" }), 400);
    await json(await request("/api/auth/register", { method: "POST", body: { ...valid, name: "x".repeat(9000) } }), 413);
    assert.equal(await db.user.count({ where: { email } }), 0);
  });
  await check("Registration creates a safe USER, zero Decimal wallet and hashed session", async () => {
    const response = await request("/api/auth/register", { method: "POST", body: { name: " Test User ", email: ` ${email.toUpperCase()} `, password, confirmPassword: password } });
    const { user } = await json(response, 201);
    userId = user.id; userIds.push(userId); cookie = cookieOf(response);
    assert.equal(user.name, "Test User"); assert.equal(user.email, email); assert.equal(user.role, "USER"); assert.equal(user.status, "ACTIVE");
    assert.equal(user.wallet.balance, "0.00000000000000000000"); assert.equal(user.wallet.reservedBalance, "0.00000000000000000000"); assert.equal(user.wallet.balanceDisplay, "¥0.00");
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { wallet: true } });
    assert(stored.passwordHash.startsWith("scrypt$65536$8$2$") && stored.passwordHash !== password, "Password must use a salted, expensive hash.");
    assert(stored.wallet?.balance.isZero() && stored.wallet.reservedBalance.isZero());
    const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(cookie) } });
    assert.equal(session.userId, userId); assert(session.tokenHash !== cookie.split("=")[1]);
    const cookieHeader = response.headers.get("set-cookie") ?? "";
    assert(/HttpOnly/i.test(cookieHeader) && /Secure/i.test(cookieHeader) && /SameSite=lax/i.test(cookieHeader) && /Path=\//i.test(cookieHeader));
    assert(!/Max-Age/i.test(cookieHeader), "Without Remember me, cookie is a browser session cookie.");
    assert(Math.abs(session.expiresAt.getTime() - Date.now() - 86400000) < 5000);
  });
  await check("Duplicate email is case insensitive and does not create a second wallet", async () => {
    const response = await request("/api/auth/register", { method: "POST", body: { name: "Duplicate", email: email.toUpperCase(), password, confirmPassword: password } });
    const result = await json(response, 409); assert(result.fieldErrors.email);
    assert.equal(await db.user.count({ where: { email } }), 1); assert.equal(await db.wallet.count({ where: { userId } }), 1);
  });
  await check("Wrong and unknown passwords return the same error", async () => {
    const wrong = await json(await request("/api/auth/login", { method: "POST", body: { email, password: "wrong-password" } }), 401);
    const unknown = await json(await request("/api/auth/login", { method: "POST", body: { email: unknownEmail, password } }), 401);
    assert.equal(wrong.error, unknown.error);
  });
  await check("Session persists; user routes work and Admin is denied", async () => {
    const result = await json(await request("/api/auth/session", { cookie }), 200); assert.equal(result.user.id, userId);
    for (const path of dashboardPaths) {
      const response = await request(path, { cookie }); assert.equal(response.status, 200); const html = await response.text(); safe(html); assert(!html.includes("NEXT_REDIRECT"));
    }
    for (const path of adminPaths) await deniedAdmin(path, cookie);
    await deniedAdmin("/admin/users", cookie, { RSC: "1" });
    await redirected("/login", "/dashboard", cookie); await redirected("/register", "/dashboard", cookie);
  });
  await check("A second account has a different salt and an isolated session", async () => {
    const response = await request("/api/auth/register", { method: "POST", body: { name: "Other User", email: otherEmail, password, confirmPassword: password } });
    const result = await json(response, 201); otherId = result.user.id; userIds.push(otherId); otherCookie = cookieOf(response);
    const a = await db.user.findUniqueOrThrow({ where: { id: userId } }); const b = await db.user.findUniqueOrThrow({ where: { id: otherId } });
    assert(a.passwordHash !== b.passwordHash, "Identical passwords require different salts.");
    assert.equal((await json(await request("/api/auth/session", { cookie: otherCookie }), 200)).user.id, otherId);
    assert.equal((await json(await request("/api/auth/session", { cookie }), 200)).user.id, userId);
  });
  await check("Profile saves only current user's name, rejects identity and role injection", async () => {
    const result = await json(await request("/api/profile", { method: "PATCH", cookie, body: { name: "  Updated Name  " } }), 200);
    assert.equal(result.user.name, "Updated Name");
    assert.equal((await json(await request("/api/profile", { cookie }), 200)).user.name, "Updated Name");
    for (const field of [{ userId: otherId }, { id: otherId }, { email: otherEmail }, { role: "ADMIN" }, { status: "SUSPENDED" }]) {
      await json(await request("/api/profile", { method: "PATCH", cookie, body: { name: "Injected", ...field } }), 422);
    }
    await json(await request("/api/profile", { method: "PATCH", cookie, body: { name: " " } }), 422);
    await json(await request("/api/profile", { method: "PATCH", cookie, body: { name: "x".repeat(81) } }), 422);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).name, "Updated Name");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: otherId } })).name, "Other User");
  });
  await check("Logout deletes the server session; old cookies cannot replay", async () => {
    const response = await request("/api/auth/logout", { method: "POST", cookie, body: {} }); await json(response, 200);
    assert(/Max-Age=0/i.test(response.headers.get("set-cookie") ?? ""));
    assert.equal(await db.session.count({ where: { tokenHash: hashToken(cookie) } }), 0);
    assert.equal((await json(await request("/api/auth/session", { cookie }), 200)).user, null);
    await redirected("/dashboard", "/login", cookie);
    await json(await request("/api/auth/logout", { method: "POST", cookie, body: {} }), 200);
  });
  await check("Remember me lasts 30 days and login rotates sessions", async () => {
    const remembered = await login(true); cookie = remembered.cookie;
    assert(/Max-Age=2592000/i.test(remembered.response.headers.get("set-cookie") ?? ""));
    const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(cookie) } });
    assert(Math.abs(session.expiresAt.getTime() - Date.now() - 30 * 86400000) < 5000);
    const previous = cookie; cookie = (await login(false, cookie)).cookie;
    assert(cookie !== previous); assert.equal((await json(await request("/api/auth/session", { cookie: previous }), 200)).user, null);
    assert.equal((await json(await request("/api/auth/session", { cookie }), 200)).user.id, userId);
  });
  await check("Expired and forged sessions cannot access Dashboard or Profile", async () => {
    await db.session.update({ where: { tokenHash: hashToken(cookie) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await json(await request("/api/auth/session", { cookie }), 200)).user, null);
    await json(await request("/api/profile", { cookie }), 401); await redirected("/dashboard", "/login", cookie);
    const forged = `__Host-aihub-session=${randomBytes(32).toString("base64url")}`;
    assert.equal((await json(await request("/api/auth/session", { cookie: forged }), 200)).user, null);
    await redirected("/admin", "/login", forged); cookie = (await login()).cookie;
  });
  await check("Suspended users are blocked even with an existing session", async () => {
    await db.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    assert.equal((await json(await request("/api/auth/session", { cookie }), 200)).user, null);
    await json(await request("/api/profile", { method: "PATCH", cookie, body: { name: "Blocked" } }), 401);
    await redirected("/dashboard", "/login", cookie);
    await json(await request("/api/auth/login", { method: "POST", body: { email, password } }), 401);
    await db.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  });
  await check("Admin grants and role removal are enforced from the database", async () => {
    await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    const adminLogin = await login(false, cookie);
    cookie = adminLogin.cookie;
    assert.equal(adminLogin.user.role, "ADMIN");
    await redirected("/login", "/admin", cookie);
    await redirected("/register", "/admin", cookie);
    for (const path of adminPaths) { const response = await request(path, { cookie }); assert.equal(response.status, 200); const html = await response.text(); safe(html); assert(!html.includes("NEXT_REDIRECT")); }
    await db.user.update({ where: { id: userId }, data: { role: "USER" } });
    await redirected("/login", "/dashboard", cookie);
    await redirected("/register", "/dashboard", cookie);
    for (const path of adminPaths) await deniedAdmin(path, cookie);
    await deniedAdmin("/admin/users", cookie, { RSC: "1", "Next-Router-Prefetch": "1" });
  });
  await check("Sign out all devices revokes every session of only the current user", async () => {
    const second = (await login(true)).cookie;
    assert.equal(await db.session.count({ where: { userId } }), 2);
    await json(await request("/api/auth/logout", { method: "POST", cookie, body: { all: true } }), 200);
    assert.equal(await db.session.count({ where: { userId } }), 0);
    assert.equal((await json(await request("/api/auth/session", { cookie: second }), 200)).user, null);
    assert.equal((await json(await request("/api/auth/session", { cookie: otherCookie }), 200)).user.id, otherId);
  });
  await check("Authentication rate limit is persisted in PostgreSQL", async () => {
    const key = createHash("sha256").update(`login:${throttleEmail}`).digest("hex");
    const windowStart = new Date(Math.floor(Date.now() / 900000) * 900000);
    await db.authRateLimit.create({ data: { key, windowStart, attempts: 20 } });
    await json(await request("/api/auth/login", { method: "POST", body: { email: throttleEmail, password } }), 429);
    assert.equal((await db.authRateLimit.findUniqueOrThrow({ where: { key_windowStart: { key, windowStart } } })).attempts, 21);
  });
  await check("Wallet uses numeric(50,20); invalid balances are rejected by PostgreSQL", async () => {
    const columns = await db.$queryRaw<{ column_name: string; data_type: string; numeric_precision: number; numeric_scale: number }[]>`SELECT column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'Wallet' AND column_name IN ('balance', 'reservedBalance')`;
    assert.equal(columns.length, 2);
    for (const column of columns) { assert.equal(column.data_type, "numeric"); assert.equal(column.numeric_precision, 50); assert.equal(column.numeric_scale, 20); }
    assert(await db.wallet.update({ where: { userId }, data: { balance: "-0.01" } }).then(() => false).catch(() => true));
    assert(await db.wallet.update({ where: { userId }, data: { reservedBalance: "0.01" } }).then(() => false).catch(() => true));
    assert((await db.wallet.findUniqueOrThrow({ where: { userId } })).balance.isZero());
  });
  console.log(`Authentication integration checks: ${passed} passed. Test fixtures are removed on exit.`);
}

async function run() {
  try { await main(); }
  catch (error) { console.error(`FAIL ${error instanceof Error ? error.message : "Authentication test failed."}`); process.exitCode = 1; }
  finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    await db.user.deleteMany({ where: { id: { in: userIds }, email: { in: emails } } }).catch(() => { console.error("Could not remove test users."); process.exitCode = 1; });
    await db.authRateLimit.deleteMany({ where: { key: { in: rateKeys } } }).catch(() => { console.error("Could not remove test rate-limit fixtures."); process.exitCode = 1; });
    await risk.cleanup();
    await db.$disconnect();
  }
}
void run().catch(() => { console.error("Authentication test cleanup failed."); process.exitCode = 1; });
