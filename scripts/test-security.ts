import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { lookup } from "node:dns/promises";
import { config } from "dotenv";
import { Agent, MockAgent } from "undici";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { boundedBody } from "../lib/payments/providers/types";
import { HttpError } from "../lib/server/http-error";
import { applicationOrigin } from "../lib/security/origin";
import { pageSecurityHeaders } from "../lib/security/headers";
import { providerBaseUrl, isPublicAddress, publicAddresses, createPublicLookup, publicDispatcher, upstreamFetch } from "../lib/security/upstream";
import { alipayConfig, localWechat } from "./payment-fixtures";
import { AlipayProvider } from "../lib/payments/providers/alipay";
import { riskTestEnvironment } from "./risk-test-environment";
import { hashPassword } from "../lib/server/password";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
let passed = 0, active = "startup";
async function check(name: string, action: () => unknown) { active = name; await action(); console.log(`PASS ${name}`); passed++; }
function stalled() {
  let closed = false, cancelled = false, controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(value) { controller = value; value.enqueue(new TextEncoder().encode("partial")); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); } });
  return { body, get cancelled() { return cancelled; }, close() { if (!closed) { closed = true; try { controller.close(); } catch {} } } };
}
async function rejectsPromptly(action: Promise<unknown>, status = 400) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await assert.rejects(Promise.race([action, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("reader_stalled")), 1000); })]), error => error instanceof HttpError && error.status === status); }
  finally { clearTimeout(timer); }
}
async function unit() {
  await check("Payment callback deadline stops a never-ending body without awaiting its cancellation hook", async () => {
    const source = stalled(); try { await rejectsPromptly(boundedBody({ body: source.body, headers: new Headers() }, 65536, AbortSignal.timeout(30))); assert(source.cancelled); } finally { source.close(); }
  });
  await check("Payment callback handles already aborted and mid-read aborted requests", async () => {
    for (const initial of [true,false]) { const source = stalled(), abort = new AbortController();
      if (initial) abort.abort(); const pending = boundedBody({ body: source.body, headers: new Headers(), signal: abort.signal }); if (!initial) abort.abort();
      try { await rejectsPromptly(pending); assert(source.cancelled); } finally { source.close(); }
    }
  });
  await check("Both payment adapters reject stalled notification bodies before signature processing", async () => {
    for (const [provider,type] of [[new AlipayProvider(alipayConfig), "application/x-www-form-urlencoded"], [localWechat, "application/json"]] as const) {
      const source = stalled(), abort = new AbortController();
      const request = new Request("https://aihub.example.com/callback", { method: "POST", body: source.body, headers: { "Content-Type": type }, signal: abort.signal, duplex: "half" } as RequestInit);
      const pending = provider.verifyNotification(request); abort.abort();
      try { await rejectsPromptly(pending); assert(source.cancelled); } finally { source.close(); }
    }
  });
  await check("Callback advertised/actual body limits and UTF-8 reject malformed payloads", async () => {
    await rejectsPromptly(boundedBody(new Request("https://example.com", { method: "POST", body: "small", headers: { "Content-Length": "65537" } })), 413);
    await rejectsPromptly(boundedBody(new Request("https://example.com", { method: "POST", body: "x".repeat(65537) })), 413);
    await rejectsPromptly(boundedBody(new Request("https://example.com", { method: "POST", body: new Uint8Array([0xc3,0x28]) })), 400);
    assert.equal(await boundedBody(new Request("https://example.com", { method: "POST", body: "金额=50" })), "金额=50");
  });
  await check("Production CSRF origin is explicit, canonical and cannot fall back to attacker Host", () => {
    for (const APP_ORIGIN of [undefined, "", "null", "https://user:secret@example.com", "https://example.com/path", "http://example.com", "https://example.com?ignored=1"])
      assert.throws(() => applicationOrigin("https://attacker.example.com", { NODE_ENV: "production", APP_ORIGIN }), HttpError);
    assert.equal(applicationOrigin(undefined, { NODE_ENV: "production", APP_ORIGIN: "https://aihub.example.com/" }), "https://aihub.example.com");
  });
  await check("Provider origins are exact, per-provider and reject private/metadata/IP destinations", () => {
    const env = { NODE_ENV: "production" as const };
    for (const target of ["http://127.0.0.1/v1", "https://127.0.0.1", "https://169.254.169.254", "https://0x7f000001", "https://2130706433", "https://[::ffff:127.0.0.1]", "https://192.168.1.1", "https://internal.local", "https://api.deepseek.com.attacker.com", "https://api.openai.com"])
      assert.throws(() => providerBaseUrl(target, "DEEPSEEK", env));
    assert.equal(providerBaseUrl("https://api.deepseek.com/v1", "DEEPSEEK", env).origin, "https://api.deepseek.com");
    const custom = { ...env, DEEPSEEK_ALLOWED_ORIGINS: "https://backup.aihub.example.com:8443" };
    assert.equal(providerBaseUrl("https://backup.aihub.example.com:8443/v1", "DEEPSEEK", custom).port, "8443");
    assert.throws(() => providerBaseUrl("https://backup.aihub.example.com/v1", "DEEPSEEK", custom));
  });
  await check("Loopback upstreams require isolated fixture opt-in and cannot be enabled against production data", () => {
    const test = "postgresql://fixture@127.0.0.1/aihub_auth_test", env = { NODE_ENV: "production" as const, AIHUB_LOCAL_PROVIDER_TESTS: "true", DATABASE_URL_TEST: test, DATABASE_URL: "postgresql://fixture@127.0.0.1/aihub" };
    assert.throws(() => providerBaseUrl("http://127.0.0.1:3199", "DEEPSEEK", env));
    assert.equal(providerBaseUrl("http://127.0.0.1:3199", "DEEPSEEK", { ...env, DATABASE_URL: test }).port, "3199");
  });
  await check("Connect-time DNS validation rejects private, mixed, mapped and tunnel addresses", async () => {
    for (const ip of ["0.0.0.0","10.0.0.1","127.0.0.1","100.64.0.1","169.254.169.254","172.16.0.1","192.168.1.1","198.18.0.1","224.1.1.1","::1","::ffff:127.0.0.1","fc00::1","fe80::1","2001:db8::1","2002:7f00:1::1","2001::1","2001:0:0:0:0:0:0:1","2001:2::1","2001:10::1","2001:20::1","2001:1ff:ffff::1","3fff::1","3fff:fff::1","3fff:0:0:0:0:0:0:1"]) assert.equal(isPublicAddress(ip), false);
    assert(isPublicAddress("8.8.8.8") && isPublicAddress("2606:4700:4700::1111"));
    assert(isPublicAddress("2001:4860:4860::8888") && isPublicAddress("2001:200::1"));
    assert.throws(() => publicAddresses([{address:"8.8.8.8",family:4},{address:"127.0.0.1",family:4}]));
    assert.throws(() => publicAddresses([{address:"2606:4700:4700::1111",family:6},{address:"2001::1",family:6}]));
    let resolves = 0;
    const resolver = (async () => { resolves++; return [{address:"127.0.0.1",family:4}]; }) as unknown as typeof lookup;
    await new Promise<void>(resolve => createPublicLookup(resolver)("allowed.example.com", {}, error => { assert(error); resolve(); }));
    assert.equal(resolves, 1);
    const tunnel = (async () => [{address:"2001::1",family:6}]) as unknown as typeof lookup;
    await new Promise<void>(resolve => createPublicLookup(tunnel)("allowed.example.com", {}, error => { assert(error); resolve(); }));
    const safe = (async () => [{address:"8.8.8.8",family:4}]) as unknown as typeof lookup;
    await new Promise<void>(resolve => createPublicLookup(safe)("allowed.example.com", {}, (error,address,family) => { assert.equal(error,null); assert.equal(address,"8.8.8.8"); assert.equal(family,4); resolve(); }));
  });
  await check("The actual public dispatcher supports native fetch responses and cancellation without opening a network connection", async () => {
    const mock = new MockAgent(); mock.disableNetConnect();
    const pool = mock.get("https://api.deepseek.com");
    pool.intercept({ path: "/security-success" }).reply(200,"safe");
    pool.intercept({ path: "/security-abort" }).reply(200,"late").delay(100);
    const original = Agent.prototype.dispatch; let calls = 0;
    // Intercept only the Agent's transport, keeping the application's wrapper and
    // Node's real native fetch handler protocol. A bare v8 Agent fails this test.
    Agent.prototype.dispatch = function (options,handler) { calls++; return pool.dispatch(options,handler); };
    try {
      const response = await upstreamFetch(new URL("https://api.deepseek.com/security-success"),{ redirect:"error" });
      assert.equal(response.status,200); assert.equal(await response.text(),"safe");
      await assert.rejects(upstreamFetch(new URL("https://api.deepseek.com/security-abort"),{ signal:AbortSignal.timeout(30) }), error => error instanceof Error && ["AbortError","TimeoutError"].includes(error.name));
      assert.equal(calls,2); mock.assertNoPendingInterceptors();
    } finally { Agent.prototype.dispatch = original; await mock.close(); }
  });
  await check("CSP nonces are fresh, production disallows inline script/eval, and framing/referrers are restricted", () => {
    const a = pageSecurityHeaders(true,true), b = pageSecurityHeaders(true,true); assert.notEqual(a.nonce,b.nonce);
    const scripts = a.headers["Content-Security-Policy"].split(";").find(value => value.trim().startsWith("script-src"))!;
    assert(!scripts.includes("unsafe-inline") && !scripts.includes("unsafe-eval")); assert(scripts.includes(`nonce-${a.nonce}`));
    assert(a.headers["Content-Security-Policy"].includes("frame-ancestors 'none'")); assert.equal(a.headers["Referrer-Policy"],"no-referrer"); assert.equal(a.headers["X-Frame-Options"],"DENY");
    assert(a.headers["Strict-Transport-Security"]); assert(!pageSecurityHeaders(true,false).headers["Strict-Transport-Security"]);
  });
}

let child: ChildProcess | undefined, db: PrismaClient | undefined, cleanupRisk: ReturnType<typeof riskTestEnvironment> | undefined;
const seed = randomBytes(8).toString("hex"), ids: string[] = [], origin = "http://127.0.0.1:3170";
async function integration() {
  const database = process.env.DATABASE_URL_TEST;
  assert(database && database !== process.env.DATABASE_URL && new URL(database).pathname === "/aihub_auth_test" && ["localhost","127.0.0.1"].includes(new URL(database).hostname));
  const risk = riskTestEnvironment("security"); cleanupRisk = risk;
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database, options: "-c timezone=UTC", max: 3 }), log: [] });
  assert(await fetch(origin,{signal:AbortSignal.timeout(500)}).then(() => false).catch(() => true));
  child = spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3170"], { env: { ...process.env,...risk.env,DATABASE_URL:database,APP_ORIGIN:origin,NODE_ENV:"production",PAYMENTS_ENABLED:"false",RISK_LOGIN_IP_RPM:"3",RISK_REGISTER_IP_RPM:"3" }, windowsHide:true,stdio:["ignore","pipe","pipe"] });
  child.stdout?.on("data",() => {}); child.stderr?.on("data",() => {});
  let startupError = false;
  child.on("error", () => { startupError = true; });
  const deadline = Date.now()+30000;
  while (!await fetch(`${origin}/api/auth/session`,{signal:AbortSignal.timeout(1000)}).then(response => response.ok).catch(() => false)) { if (startupError || child.exitCode !== null || Date.now()>deadline) throw new Error("startup_failed"); await new Promise(resolve => setTimeout(resolve,200)); }
  const passwordHash = await hashPassword(`Test-only-${randomBytes(16).toString("hex")}`);
  const owner = await db.user.create({data:{name:'<img src=x onerror="alert(1)">',email:`security-${seed}@example.test`,passwordHash,wallet:{create:{balance:"1"}}}}); ids.push(owner.id);
  const token = randomBytes(32).toString("base64url");
  await db.session.create({data:{userId:owner.id,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+3600000),userAgent:"Security fixture"}}); const cookie = `__Host-aihub-session=${token}`;
  await check("All HTML paths carry uncached strict CSP and refuse attacker-supplied nonce/CSP headers", async () => {
    for (const path of ["/login","/register","/docs","/design-system","/dashboard","/playground"]) {
      const response = await fetch(origin+path,{headers:{Cookie:cookie,"X-Nonce":"attacker-chosen-nonce","Content-Security-Policy":"script-src * 'unsafe-inline'"},redirect:"manual"});
      assert([200,307].includes(response.status)); assert.equal(response.headers.get("cache-control"),"no-store"); assert.equal(response.headers.get("x-frame-options"),"DENY");
      const csp = response.headers.get("content-security-policy")!; assert(csp.includes("strict-dynamic") && !csp.includes("attacker-chosen-nonce"));
      const html = await response.text();
      if (response.status === 200) { const nonce = /'nonce-([^']+)'/.exec(csp)![1]; const tags = html.match(/<script\b[^>]*>/g) ?? []; assert(tags.length); for (const tag of tags) assert(tag.includes(`nonce="${nonce}"`)); }
    }
    for (const path of ["/.env","/.env.local","/prisma/schema.prisma","/lib/server/session.ts"]) {
      const response = await fetch(origin+path,{redirect:"manual"}); assert.equal(response.status,404); await response.body?.cancel();
    }
  });
  await check("Untrusted profile markup stays escaped in authenticated server-rendered pages", async () => {
    const response = await fetch(origin+"/dashboard",{headers:{Cookie:cookie}}); assert.equal(response.status,200);
    const html = await response.text(); assert(!html.includes('<img src=x onerror="alert(1)">')); assert(html.includes("&lt;img") || html.includes("\\u003cimg"));
  });
  await check("Legacy middleware bypass headers cannot grant anonymous or USER Admin access", async () => {
    const forged = "proxy:proxy:proxy:proxy:proxy";
    for (const path of ["/admin","/admin/users","/api/admin/overview"]) for (const signed of [false,true]) {
      const response = await fetch(origin+path,{redirect:"manual",headers:{"X-Middleware-Subrequest":forged,...(signed?{Cookie:cookie}:{})}});
      assert.equal(response.status,signed?403:path.startsWith("/api/")?401:307);
    }
  });
  await check("Mutations reject missing/null/cross-site origins even with a valid session", async () => {
    for (const value of [undefined,"null","https://attacker.example.com"]) {
      const response = await fetch(origin+"/api/profile",{method:"PATCH",headers:{Cookie:cookie,"Content-Type":"application/json",...(value?{Origin:value}:{})},body:JSON.stringify({name:"Forged"})}); assert.equal(response.status,403);
    }
    assert.equal((await db!.user.findUniqueOrThrow({where:{id:owner.id}})).name,owner.name);
  });
  await check("API key creation remains no-store, one-time only, revoked keys immediately fail Gateway", async () => {
    const response = await fetch(origin+"/api/api-keys",{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({name:"Security fixture"})}); assert.equal(response.status,201); assert.equal(response.headers.get("cache-control"),"no-store");
    const result = await response.json() as {key:string;apiKey:{id:string}};
    const listed = await fetch(origin+"/api/api-keys",{headers:{Cookie:cookie}}); assert(!(await listed.text()).includes(result.key));
    const revoked = await fetch(`${origin}/api/api-keys/${result.apiKey.id}/revoke`,{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:"{}"}); assert.equal(revoked.status,200);
    const denied = await fetch(origin+"/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${result.key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"does-not-exist",messages:[{role:"user",content:"Hello"}]})}); assert.equal(denied.status,401); assert.equal((await denied.json()).error.code,"invalid_api_key");
    assert.equal((await db!.wallet.findUniqueOrThrow({where:{userId:owner.id}})).balance.toFixed(),"1");
  });
  await check("Login brute force is limited by IP even when email/password values rotate", async () => {
    for (let i=0;i<4;i++) {
      const response = await fetch(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({email:`unknown-${seed}-${i}@example.test`,password:"Test-only-password",rememberMe:false})});
      assert.equal(response.status,i<3?401:429); if(i===3) assert(response.headers.get("retry-after"));
    }
  });
  await check("Registration limits invalid payload floods before creating any accounts or wallets", async () => {
    for(let i=0;i<4;i++) {const response=await fetch(origin+"/api/auth/register",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:"{}"});assert.equal(response.status,i<3?422:429);}
  });
}
async function run() {
  try { await unit(); if(!process.argv.includes("--unit")) await integration(); console.log(`Security regression: ${passed} checks passed (local/memory fixtures only).`); }
  catch { console.error(`FAIL ${active}. No credentials, user payloads or raw errors were printed.`); process.exitCode=1; }
  finally {
    if(child && child.exitCode===null){const done=once(child,"exit");child.kill();await Promise.race([done,new Promise(resolve=>setTimeout(resolve,3000))]);}
    if(db) {await db.user.deleteMany({where:{id:{in:ids},email:{startsWith:`security-${seed}`}}});
      const keys = Array.from({length:4},(_,i)=>createHash("sha256").update(`login:unknown-${seed}-${i}@example.test`).digest("hex"));
      await db.authRateLimit.deleteMany({where:{key:{in:keys}}});await db.$disconnect();}
    if(cleanupRisk) await cleanupRisk.cleanup();
    await publicDispatcher.close();
  }
}
void run().catch(()=>{console.error("Security fixture cleanup failed.");process.exitCode=1;});
