import { riskTestEnvironment } from "./risk-test-environment";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { AdminModelRecord, PublicModel } from "../lib/model-types";
import type { ModelInput } from "../lib/model-schemas";

config({ quiet: true });
const risk = riskTestEnvironment("models");
Object.assign(process.env, risk.env);
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("Configure the isolated DATABASE_URL_TEST first.");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/aihub_auth_test", "Tests require the local aihub_auth_test database.");
assert(databaseUrl !== process.env.DATABASE_URL, "Tests must not use the development database.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 4 }), log: [] });
const origin = "http://127.0.0.1:3103";
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production" };
const seed = randomBytes(8).toString("hex");
const emails = [`model-admin-${seed}@example.test`, `model-user-${seed}@example.test`];
const password = `Test-only-${randomBytes(16).toString("hex")}`;
const userIds: string[] = [], modelIds: string[] = [];
let server: ChildProcess | undefined;
let passed = 0;
type ResponseBody = { model: AdminModelRecord; models: AdminModelRecord[]; user: { id: string }; error?: string };
async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  return fetch(`${origin}${path}`, { method: options.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.method ? { Origin: origin, "Content-Type": "application/json" } : {}), ...options.headers }, ...(options.method ? { body: JSON.stringify(options.body ?? {}) } : {}) });
}
async function json(response: Response, status: number) { assert.equal(response.status, status, "Unexpected response status."); assert.equal(response.headers.get("cache-control"), "no-store"); return await response.json() as ResponseBody; }
async function check(name: string, action: () => Promise<void>) { await action(); passed++; console.log(`PASS ${name}`); }
async function register(email: string) {
  const response = await request("/api/auth/register", { method: "POST", body: { name: "Model Test", email, password, confirmPassword: password } });
  const { user } = await json(response, 201); userIds.push(user.id);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-aihub-session="))?.split(";")[0]; assert(cookie, "Registration must create a session."); return { id: user.id, cookie };
}
const fixture: ModelInput = { slug: `test-model-${seed}`, name: "Test Model", provider: "OPENAI", providerModel: `private-upstream-${seed}`, description: "Model integration fixture.", contextWindow: 400000, inputPricePerMillion: "0.12345678", outputPricePerMillion: "9.87654321", markupMultiplier: "1.234567", enabled: true };
function publicOnly(model: PublicModel) { assert.deepEqual(Object.keys(model).sort(), ["slug", "name", "provider", "description", "contextWindow", "inputPricePerMillion", "outputPricePerMillion"].sort()); assert.equal(typeof model.inputPricePerMillion, "string"); assert.equal(typeof model.outputPricePerMillion, "string"); }
async function publicModels(cookie?: string, query = "") { const response = await json(await request(`/api/models${query}`, { cookie }), 200); for (const model of response.models) publicOnly(model); return response.models as PublicModel[]; }
// Independent integer arithmetic oracle, including all fractional digits.
function product(a: string, b: string) { const parts = [a, b].map((value) => { const [whole, fraction = ""] = value.split("."); return { integer: BigInt(whole + fraction), scale: fraction.length }; }); const scale = parts[0].scale + parts[1].scale; const digits = (parts[0].integer * parts[1].integer).toString().padStart(scale + 1, "0"); return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "") : digits; }
async function create(cookie: string, data: ModelInput) { const result = await json(await request("/api/admin/models", { method: "POST", cookie, body: data }), 201); modelIds.push(result.model.id); return result.model; }

async function main() {
  assert(await fetch(origin, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Test port 3103 must be free.");
  try { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "pipe" }); } catch { throw new Error("Model test database migration failed."); }
  const processHandle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3103"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); server = processHandle;
  processHandle.stdout?.on("data", () => {}); processHandle.stderr?.on("data", () => {});
  let startupError = false; processHandle.on("error", () => { startupError = true; });
  const deadline = Date.now() + 30000;
  while (!await request("/api/auth/session").then((response) => response.status === 200).catch(() => false)) { if (startupError || processHandle.exitCode !== null || Date.now() > deadline) throw new Error("Model test server failed to start. Run build first."); await new Promise((resolve) => setTimeout(resolve, 250)); }
  const admin = await register(emails[0]), user = await register(emails[1]);
  await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  let model: AdminModelRecord;
  await check("Anonymous and ordinary users cannot read admin costs or write models", async () => {
    for (const [cookie, status] of [[undefined, 401], [user.cookie, 403]] as const) {
      await json(await request("/api/admin/models", { cookie }), status);
      await json(await request("/api/admin/models", { method: "POST", cookie, body: fixture }), status);
      await json(await request(`/api/admin/models/${randomUUID()}`, { method: "PATCH", cookie, body: { enabled: false, role: "ADMIN" } }), status);
    }
    assert.equal((await request("/api/models", { method: "POST", cookie: user.cookie, body: fixture })).status, 405);
    const page = await request("/admin/models", { cookie: user.cookie }); assert.equal(page.status, 403); assert((await page.text()).includes("Administrator access is required."));
  });
  await check("Admin creates a persistent model with exact Decimal costs and selling prices", async () => {
    model = await create(admin.cookie, fixture);
    assert.equal(model.inputCostPerMillion, fixture.inputPricePerMillion); assert.equal(model.providerModel, fixture.providerModel); assert.equal(model.markupMultiplier, fixture.markupMultiplier);
    assert.equal(model.inputPricePerMillion, product(fixture.inputPricePerMillion, fixture.markupMultiplier)); assert.equal(model.outputPricePerMillion, product(fixture.outputPricePerMillion, fixture.markupMultiplier));
    const stored = await db.model.findUniqueOrThrow({ where: { id: model.id } }); assert.equal(stored.inputPricePerMillion.toFixed(), fixture.inputPricePerMillion); assert.equal(stored.outputPricePerMillion.toFixed(), fixture.outputPricePerMillion); assert.equal(stored.enabled, true);
    assert((await json(await request("/api/admin/models", { cookie: admin.cookie }), 200)).models.some((item) => item.id === model.id));
  });
  await check("Public JSON and server-rendered pages include only sales prices and enabled metadata", async () => {
    for (const cookie of [undefined, user.cookie, admin.cookie]) { const item = (await publicModels(cookie, "?enabled=false&includeCosts=true")).find((item) => item.slug === fixture.slug); assert(item); publicOnly(item); assert.equal(item.inputPricePerMillion, model.inputPricePerMillion); }
    for (const path of ["/models", "/dashboard/models", "/pricing", "/", "/docs", "/dashboard/settings"]) {
      const page = await request(path, { cookie: user.cookie }); assert.equal(page.status, 200); const html = await page.text(); assert(html.includes(fixture.slug) || path === "/"); assert(!html.includes(fixture.providerModel)); for (const field of ["inputCostPerMillion", "outputCostPerMillion", "markupMultiplier", "providerModel", "marginPercent"]) assert(!html.includes(field), "Public HTML and serialized props must exclude costs.");
    }
  });
  await check("Server rejects duplicate slugs, invalid fields, floating-point prices and CSRF", async () => {
    await json(await request("/api/admin/models", { method: "POST", cookie: admin.cookie, body: fixture }), 409);
    for (const changed of [{ inputPricePerMillion: 0.1 }, { inputPricePerMillion: "-1" }, { inputPricePerMillion: "1e-8" }, { inputPricePerMillion: "0.123456789" }, { inputPricePerMillion: "100000000000000" }, { outputPricePerMillion: "NaN" }, { markupMultiplier: "0" }, { markupMultiplier: "1.1234567" }, { contextWindow: 0 }, { contextWindow: 1.5 }, { provider: "UNKNOWN" }, { providerModel: " " }, { slug: "Invalid Slug" }, { userId: user.id }, { role: "ADMIN" }]) await json(await request("/api/admin/models", { method: "POST", cookie: admin.cookie, body: { ...fixture, ...changed } }), 422);
    await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: {} }), 422);
    await json(await request("/api/admin/models", { method: "POST", cookie: admin.cookie, body: fixture, headers: { Origin: "https://foreign.example" } }), 403);
    await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: { enabled: false }, headers: { "Sec-Fetch-Site": "cross-site" } }), 403);
  });
  await check("Ordinary users cannot change an existing model's metadata, pricing or availability", async () => {
    for (const body of [{ name: "Hijacked" }, { provider: "GOOGLE", providerModel: "other" }, { markupMultiplier: "0.1" }, { enabled: false }, { inputPricePerMillion: "0" }, { userId: admin.id, role: "ADMIN" }]) await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: user.cookie, body }), 403);
    assert.equal((await db.model.findUniqueOrThrow({ where: { id: model.id } })).name, fixture.name);
  });
  await check("Admin edits every model field and recalculates sales and margin", async () => {
    const patch = { slug: `edited-${seed}`, name: "Edited Test Model", provider: "ANTHROPIC", providerModel: `private-edited-${seed}`, description: "Edited description.", contextWindow: 200000, inputPricePerMillion: "0.1", outputPricePerMillion: "0.2", markupMultiplier: "1.5" };
    model = (await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: patch }), 200)).model;
    assert.equal(model.slug, patch.slug); assert.equal(model.provider, "Anthropic"); assert.equal(model.providerModel, patch.providerModel); assert.equal(model.contextWindow, patch.contextWindow); assert.equal(model.inputPricePerMillion, "0.15"); assert.equal(model.outputPricePerMillion, "0.3"); assert.equal(model.inputMarginPerMillion, "0.05"); assert.equal(model.outputMarginPerMillion, "0.1"); assert.equal(model.marginPercent, "33.3333");
    assert(!(await publicModels()).some((item) => item.slug === fixture.slug)); assert((await publicModels()).some((item) => item.slug === patch.slug));
    await json(await request(`/api/admin/models/${randomUUID()}`, { method: "PATCH", cookie: admin.cookie, body: { enabled: false } }), 404);
  });
  await check("Disable removes models from every public catalog; Enable restores them", async () => {
    model = (await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: { enabled: false } }), 200)).model; assert.equal(model.enabled, false);
    for (const cookie of [undefined, user.cookie, admin.cookie]) assert(!(await publicModels(cookie)).some((item) => item.slug === model.slug));
    for (const path of ["/models", "/dashboard/models", "/pricing", "/", "/docs", "/dashboard/settings"]) { const page = await request(path, { cookie: user.cookie }); assert.equal(page.status, 200); assert(!(await page.text()).includes(model.slug)); }
    assert((await json(await request("/api/admin/models", { cookie: admin.cookie }), 200)).models.some((item) => item.id === model.id && !item.enabled));
    await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: { enabled: true } }), 200); assert((await publicModels()).some((item) => item.slug === model.slug));
  });
  await check("Decimal multiplication retains all 32 significant digits and tiny fractions", async () => {
    for (const [cost, multiplier] of [["999999999999.99999999", "999999.999999"], ["0.00000001", "0.000001"], ["0.1", "0.2"]]) {
      const result = (await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: { inputPricePerMillion: cost, markupMultiplier: multiplier } }), 200)).model;
      assert.equal(result.inputPricePerMillion, product(cost, multiplier)); assert.equal((await publicModels()).find((item) => item.slug === model.slug)?.inputPricePerMillion, product(cost, multiplier));
    }
    const zero = (await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: { inputPricePerMillion: "0", outputPricePerMillion: "0" } }), 200)).model; assert.equal(zero.inputPricePerMillion, "0"); assert.equal(zero.marginPercent, null);
  });
  await check("Database types and constraints enforce Decimal prices, positive context and markup", async () => {
    const columns = await db.$queryRaw<{ column_name: string; data_type: string; numeric_precision: number; numeric_scale: number }[]>`SELECT column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'Model'`;
    for (const field of ["inputPricePerMillion", "outputPricePerMillion"]) { const column = columns.find((item) => item.column_name === field); assert.equal(column?.data_type, "numeric"); assert.equal(column?.numeric_precision, 22); assert.equal(column?.numeric_scale, 8); }
    assert.equal(columns.find((item) => item.column_name === "markupMultiplier")?.data_type, "numeric");
    for (const data of [{ inputPricePerMillion: "-1" }, { outputPricePerMillion: "-1" }, { markupMultiplier: "0" }, { contextWindow: 0 }]) await assert.rejects(db.model.update({ where: { id: model.id }, data }), "Database must reject invalid model values.");
  });
  await check("Role and status are rechecked on every admin read and write", async () => {
    await db.user.update({ where: { id: admin.id }, data: { role: "USER" } });
    await json(await request("/api/admin/models", { cookie: admin.cookie }), 403); await json(await request(`/api/admin/models/${model.id}`, { method: "PATCH", cookie: admin.cookie, body: { enabled: false } }), 403);
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN", status: "SUSPENDED" } });
    await json(await request("/api/admin/models", { cookie: admin.cookie }), 401); await json(await request("/api/admin/models", { method: "POST", cookie: admin.cookie, body: fixture }), 401);
  });
  console.log(`Model integration checks: ${passed} passed.`);
}
async function run() {
  try { await main(); } catch (error) { console.error(`FAIL ${error instanceof Error ? error.message : "Model integration test failed."}`); process.exitCode = 1; }
  finally {
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); }
    await db.model.deleteMany({ where: { id: { in: modelIds } } }).catch(() => { console.error("Model fixture cleanup failed."); process.exitCode = 1; });
    await db.user.deleteMany({ where: { id: { in: userIds }, email: { in: emails } } }).catch(() => { console.error("Model test user cleanup failed."); process.exitCode = 1; });
    const keys = emails.flatMap((email) => ["register", "login"].map((action) => createHash("sha256").update(`${action}:${email}`).digest("hex")));
    await db.authRateLimit.deleteMany({ where: { key: { in: keys } } }).catch(() => { console.error("Model test rate-limit cleanup failed."); process.exitCode = 1; }); await risk.cleanup();
    await db.$disconnect();
  }
}
void run().catch(() => { console.error("Model test cleanup failed."); process.exitCode = 1; });
