import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { generateApiKey } from "../lib/server/api-key-crypto";
import { money } from "../lib/billing/money";
import { riskTestEnvironment } from "./risk-test-environment";

// Closed-loop virtual users, equivalent to constant-VU k6 execution, with no retries.
// Run the exact same CLI/config for before and after; this never builds the app.
config({ quiet: true });
const option = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const label = option("label", "before"), durationSeconds = Number(option("duration", "10"));
const concurrencyLevels = option("concurrency", "10,50,100,500").split(",").map(Number);
const modes = option("modes", "normal,stream").split(",");
const identities = option("identities", "multi,single").split(",");
assert(/^[a-zA-Z0-9_-]{1,50}$/.test(label));
assert(durationSeconds >= 1 && durationSeconds <= 60);
assert(concurrencyLevels.every(n => Number.isInteger(n) && n > 0 && n <= 500));
assert(modes.every(m => ["normal", "stream"].includes(m)) && identities.every(i => ["multi", "single"].includes(i)));
const databaseUrl = process.env.DATABASE_URL_TEST;
assert(databaseUrl && databaseUrl !== process.env.DATABASE_URL, "An isolated test database is required.");
const parsed = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.pathname === "/aihub_auth_test");
const risk = riskTestEnvironment("performance"), runId = randomBytes(6).toString("hex");
const origin = "http://127.0.0.1:3190", upstream = "http://127.0.0.1:3191";
const upstreamKey = `performance-fixture-${randomBytes(24).toString("hex")}`;
const env: NodeJS.ProcessEnv = { ...process.env, ...risk.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, NODE_ENV: "production",
  PAYMENTS_ENABLED: "false", OPENAI_API_KEY: upstreamKey, OPENAI_BASE_URL: `${upstream}/v1`, OPENAI_TIMEOUT_MS: "90000",
  GATEWAY_API_KEY_RPM: "100000", GATEWAY_REQUESTS_PER_MINUTE: "100000", GATEWAY_API_KEY_CONCURRENCY: "1000",
  ROUTER_MAX_RETRIES: "0", PERFORMANCE_PROVIDER_PORT: "3191", PERFORMANCE_PROVIDER_KEY: upstreamKey,
  // Prevent inherited optional upstream credentials from being used by mistake.
  ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", DEEPSEEK_API_KEY: "", UPSTREAM_API_KEY: "",
};
Object.assign(process.env, env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC", max: 2, connectionTimeoutMillis: 5000 }), log: [] });
const children: ChildProcess[] = [], allUserIds: string[] = [], allModelIds: string[] = [], allChannelIds: string[] = [];
const outputDirectory = resolve("../../work/performance");
mkdirSync(outputDirectory, { recursive: true });
type ResourceSample = { timestampMs: number; cpuTotalMs: number; workingSetBytes: number; privateBytes: number; logicalProcessors: number };
type DatabaseSample = { timestampMs: number; total: number; active: number; lockWaiting: number; idleInTransaction: number };
type RequestSample = { startMs: number; latencyMs: number; status: number; ok: boolean; ttftMs?: number; error?: string; transportCode?: string; requestId?: string };
type Fixture = { userIds: string[]; keys: string[]; modelId: string; slug: string; channelId: string };
const resources: ResourceSample[] = [], databaseSamples: DatabaseSample[] = [], serverErrors: Record<string, number> = {};
const results: Record<string, unknown>[] = [];
let databaseSampling = true, databaseLoop: Promise<void> | undefined, stage = "startup", cleanupVerified = false;
const quantiles = (values: number[]) => {
  if (!values.length) return { count: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = values.toSorted((a, b) => a - b), q = (p: number) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] * 100) / 100;
  return { count: values.length, p50: q(.5), p95: q(.95), p99: q(.99), max: q(1) };
};
const metadata = { label, runId, createdAt: new Date().toISOString(), node: process.version, platform: platform(),
  hardware: { logicalProcessors: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryBytes: totalmem() },
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  gatewayBundleSha256: createHash("sha256").update(readFileSync(".next/server/app/v1/chat/completions/route.js")).digest("hex"),
  harnessHash: createHash("sha256").update(readFileSync("scripts/performance.ts")).update(readFileSync("scripts/performance-provider.mjs")).digest("hex"),
  configuration: { durationSeconds, concurrencyLevels, modes, identities, users: "one per VU in multi; one total in single", warmupRequests: 10,
    provider: "loopback OpenAI protocol fixture", normalDelayMs: 10, streamFirstContentDelayMs: 10, streamTotalDelayMs: 30,
    tokenUsage: { input: 12, output: 7 }, inputPricePerMillion: "2", outputPricePerMillion: "8", markup: "1.25", initialBalancePerUser: "100",
    requestTimeoutMs: 120000, requestBody: { messages: [{ role: "user", content: "Fixed performance fixture input" }], max_tokens: 32 },
    limits: Object.fromEntries(Object.entries(env).filter(([key]) => /^(GATEWAY_|PROVIDER_CHANNEL_|ROUTER_MAX_RETRIES)/.test(key))),
    fixtureChannel: { rpm: 1000000, tpm: 1000000000, concurrency: 1000, failureThreshold: 1000 },
    database: "local aihub_auth_test", redis: "local DB15 with unique per-run namespace", appInstances: 1,
  },
  methodology: { execution: "Closed-loop VUs, no pacing or retry; stop starting work after duration, then drain every in-flight request.",
    rps: "completed attempts / actual elapsed seconds including drain; offered and in-window completion rates also reported.",
    latency: "Client wall time from fetch initiation through full body consumption. Exact nearest-rank quantiles of raw samples.",
    ttft: "Stream request start to first nonempty assistant content delta (not headers or role-only events).",
    cpu: "Windows Get-Process TotalProcessorTime deltas / sample wall interval * 100 = one-core percent; divide by logicalProcessors for whole-machine normalized percent. Gateway PID only; excludes provider, load generator, PostgreSQL and Redis.",
    memory: "Windows gateway WorkingSet64 (resident) and PrivateMemorySize64 sampled approximately every 1 second.",
    databaseConnections: "pg_stat_activity for current test database excluding the sampling connection; includes gateway and any other same-database sessions. Observed separately at roughly 1-second intervals.",
    isolation: "Fresh own users/wallets/model/channel per scenario; cleanup after audit. Shared schema, same build/config, real Gateway+Wallet+channel routing. No live upstream or payment calls.",
    limitation: "Single Windows host includes load generator, mock, PostgreSQL and Redis. This is local comparative capacity, not a production sizing guarantee; closed-loop tests are not open-loop arrival-rate tests.",
  },
};
function save() { writeFileSync(resolve(outputDirectory, `${label}.json`), JSON.stringify({ metadata, stage, cleanupVerified, serverErrors, results, resources, databaseSamples }, null, 2)); }
function child(args: string[], childEnv = env) {
  const handle = spawn(process.execPath, args, { env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(handle);
  for (const stream of [handle.stdout, handle.stderr]) stream?.on("data", data => {
    // Only record a bounded vocabulary of error identifiers, never complete logs or credentials.
    for (const match of String(data).matchAll(/\b(P2024|P2028|P2034|ECONNREFUSED|ETIMEDOUT|pool_timeout|transaction_timeout)\b/g)) serverErrors[match[1]] = (serverErrors[match[1]] ?? 0) + 1;
  });
  return handle;
}
async function ready(url: string, handle: ChildProcess) {
  const deadline = Date.now() + 30000;
  while (!await fetch(url, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false)) {
    if (handle.exitCode !== null || Date.now() > deadline) throw new Error("Fixture server failed to start; build must already exist.");
    await delay(100);
  }
}
async function seedFixture(count: number): Promise<Fixture> {
  const userIds = Array.from({ length: count }, () => randomUUID()); allUserIds.push(...userIds);
  const credentials = userIds.map(() => generateApiKey());
  await db.user.createMany({ data: userIds.map((id, i) => ({ id, email: `performance-${runId}-${allModelIds.length}-${i}@example.test`, name: "Performance fixture", passwordHash: "disabled-fixture-password" })) });
  await db.wallet.createMany({ data: userIds.map(userId => ({ userId, balance: "100" })) });
  await db.apiKey.createMany({ data: userIds.map((userId, i) => ({ userId, name: "Performance fixture", keyHash: credentials[i].keyHash, keyPrefix: credentials[i].keyPrefix })) });
  const slug = `performance-${runId}-${allModelIds.length}`;
  const model = await db.model.create({ data: { slug, name: "Performance fixture", provider: "OPENAI", providerModel: slug,
    description: "Local isolated HTTP performance fixture", contextWindow: 4096, inputPricePerMillion: "2", outputPricePerMillion: "8", markupMultiplier: "1.25", enabled: true } });
  allModelIds.push(model.id);
  await risk.bindRouting(db, model, env);
  const binding = await db.modelChannel.findFirstOrThrow({ where: { modelId: model.id }, select: { channelId: true } });
  allChannelIds.push(binding.channelId);
  return { userIds, keys: credentials.map(c => c.key), modelId: model.id, slug, channelId: binding.channelId };
}
async function request(fixture: Fixture, keyIndex: number, stream: boolean, startEpoch: number): Promise<RequestSample> {
  const began = performance.now(), sample: RequestSample = { startMs: Date.now() - startEpoch, latencyMs: 0, status: 0, ok: false };
  try {
    const response = await fetch(`${origin}/v1/chat/completions`, { method: "POST", signal: AbortSignal.timeout(120000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${fixture.keys[keyIndex]}` },
      body: JSON.stringify({ model: fixture.slug, messages: [{ role: "user", content: "Fixed performance fixture input" }], max_tokens: 32, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }),
    });
    sample.status = response.status; sample.requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok || !stream) {
      const body = await response.json();
      sample.ok = response.ok && body.usage?.prompt_tokens === 12 && body.usage?.completion_tokens === 7 && body.usage?.total_tokens === 19;
      if (!sample.ok) sample.error = /^[a-z_]{1,64}$/.test(body.error?.code) ? body.error.code : "response_invalid";
    } else {
      assert(response.body); const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "", doneMarkers = 0, confirmedUsage = false, streamError = false;
      for (;;) {
        const read = await reader.read(); if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true }).replaceAll("\r\n", "\n");
        for (;;) {
          const delimiter = buffer.indexOf("\n\n"); if (delimiter < 0) break;
          const frame = buffer.slice(0, delimiter); buffer = buffer.slice(delimiter + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          if (data === "[DONE]") { doneMarkers++; continue; }
          const event = JSON.parse(data);
          if (event.error) { streamError = true; sample.error = /^[a-z_]{1,64}$/.test(event.error.code) ? event.error.code : "stream_error"; }
          if (sample.ttftMs === undefined && event.choices?.some((choice: { delta?: { content?: string } }) => choice.delta?.content)) sample.ttftMs = performance.now() - began;
          if (event.usage?.prompt_tokens === 12 && event.usage?.completion_tokens === 7 && event.usage?.total_tokens === 19) confirmedUsage = true;
        }
      }
      sample.ok = doneMarkers === 1 && confirmedUsage && !streamError && sample.ttftMs !== undefined;
      if (!sample.ok && !sample.error) sample.error = "stream_incomplete";
    }
  } catch (error) {
    sample.error = error instanceof Error && error.name === "TimeoutError" ? "client_timeout" : "client_failure";
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
    if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EADDRINUSE", "ENOBUFS", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code ?? "")) sample.transportCode = code;
  }
  sample.latencyMs = performance.now() - began;
  return sample;
}
async function audit(fixture: Fixture, completed: RequestSample[]) {
  const deadline = Date.now() + 60000;
  while (await db.apiRequest.count({ where: { userId: { in: fixture.userIds }, status: "PENDING" } }) && Date.now() < deadline) await delay(500);
  const rows = await db.apiRequest.findMany({ where: { userId: { in: fixture.userIds } }, include: { transaction: true, attempts: true } });
  const wallets = await db.wallet.findMany({ where: { userId: { in: fixture.userIds } } });
  const invalidSuccess = rows.filter(row => row.status === "SUCCESS" && (!row.settledAt || !row.transaction || row.transaction.type !== "USAGE" ||
    !row.userCost?.eq("0.0001") || !row.providerCost?.eq("0.00008") || row.providerCostStatus !== "KNOWN" ||
    !row.transaction.amount.eq("-0.0001") || !row.transaction.balanceBefore.plus(row.transaction.amount).eq(row.transaction.balanceAfter) ||
    row.inputTokens !== 12 || row.outputTokens !== 7 || row.attempts.length !== 1));
  const invalidFailure = rows.filter(row => row.status === "FAILED" && (row.transaction || !row.settledAt || !row.userCost?.isZero()));
  const unmatched = completed.filter(s => s.ok && !rows.some(row => row.requestId === s.requestId && row.status === "SUCCESS"));
  const balanceMismatch = wallets.filter(wallet => !wallet.balance.eq(money("100").minus(rows.filter(r => r.userId === wallet.userId).reduce((sum, r) => sum.plus(r.userCost ?? "0"), money("0")))));
  const result = { requests: rows.length, successfulRequests: rows.filter(r => r.status === "SUCCESS").length,
    failedRequests: rows.filter(r => r.status === "FAILED").length, pendingRequests: rows.filter(r => r.status === "PENDING").length,
    usageLedgerRows: rows.filter(r => r.transaction).length, providerAttempts: rows.reduce((n, r) => n + r.attempts.length, 0),
    invalidSuccess: invalidSuccess.length, invalidFailure: invalidFailure.length, unmatchedHttpSuccess: unmatched.length, balanceMismatches: balanceMismatch.length,
    nonzeroHoldWallets: wallets.filter(w => !w.reservedBalance.isZero()).length, negativeBalances: wallets.filter(w => w.balance.isNegative()).length,
  };
  return { ...result, passed: !result.pendingRequests && !result.invalidSuccess && !result.invalidFailure && !result.unmatchedHttpSuccess && !result.balanceMismatches && !result.nonzeroHoldWallets && !result.negativeBalances };
}
async function cleanupFixture(fixture: Fixture) {
  await db.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await db.model.delete({ where: { id: fixture.modelId } });
  await db.providerChannel.delete({ where: { id: fixture.channelId } });
}
async function scenario(mode: string, identity: string, concurrency: number) {
  stage = `${mode}/${identity}/${concurrency}`;
  const fixture = await seedFixture(identity === "multi" ? concurrency : 1);
  const warmup: RequestSample[] = [];
  for (let i = 0; i < 10; i++) warmup.push(await request(fixture, i % fixture.keys.length, mode === "stream", Date.now()));
  assert(warmup.every(s => s.ok), "Warmup failed.");
  const began = performance.now(), startEpoch = Date.now(), samples: RequestSample[] = [];
  const workers = Array.from({ length: concurrency }, async (_, index) => {
    do { samples.push(await request(fixture, index % fixture.keys.length, mode === "stream", startEpoch)); }
    while (performance.now() - began < durationSeconds * 1000);
  });
  await Promise.all(workers);
  const elapsedMs = performance.now() - began, endEpoch = Date.now();
  const inWindow = samples.filter(s => s.startMs + s.latencyMs <= durationSeconds * 1000);
  const statusCounts: Record<string, number> = {}, errors: Record<string, number> = {};
  for (const sample of samples) { statusCounts[sample.status] = (statusCounts[sample.status] ?? 0) + 1; if (sample.error) errors[sample.error] = (errors[sample.error] ?? 0) + 1; }
  const resource = resources.filter(s => s.timestampMs >= startEpoch && s.timestampMs <= endEpoch);
  const cpu = resource.slice(1).map((s, i) => (s.cpuTotalMs - resource[i].cpuTotalMs) / (s.timestampMs - resource[i].timestampMs) * 100);
  const database = databaseSamples.filter(s => s.timestampMs >= startEpoch && s.timestampMs <= endEpoch);
  const billing = await audit(fixture, [...warmup, ...samples]);
  const result = { mode, identity, concurrency, startEpoch, endEpoch, requestedLoadSeconds: durationSeconds, elapsedMs, drainMs: Math.max(0, elapsedMs - durationSeconds * 1000),
    requests: samples.length, successfulRequests: samples.filter(s => s.ok).length, actualRps: samples.length / (elapsedMs / 1000),
    successfulRps: samples.filter(s => s.ok).length / (elapsedMs / 1000), offeredRps: samples.length / durationSeconds,
    inWindowCompletedRps: inWindow.length / durationSeconds, inWindowSuccessfulRps: inWindow.filter(s => s.ok).length / durationSeconds,
    errorRate: samples.filter(s => !s.ok).length / samples.length, statusCounts, errors,
    rateLimited: samples.filter(s => s.status === 429).length, serverFailures: samples.filter(s => s.status >= 500).length,
    clientFailures: samples.filter(s => s.error?.startsWith("client_")).length,
    latencyMs: quantiles(samples.map(s => s.latencyMs)), successfulLatencyMs: quantiles(samples.filter(s => s.ok).map(s => s.latencyMs)),
    ttftMs: quantiles(samples.filter(s => s.ttftMs !== undefined).map(s => s.ttftMs!)),
    gatewayResources: { samples: resource.length, oneCoreCpuPercent: quantiles(cpu), normalizedCpuPercent: quantiles(cpu.map(n => n / cpus().length)),
      peakWorkingSetBytes: Math.max(0, ...resource.map(s => s.workingSetBytes)), peakPrivateBytes: Math.max(0, ...resource.map(s => s.privateBytes)) },
    database: { samples: database.length, peakConnections: Math.max(0, ...database.map(s => s.total)), peakActive: Math.max(0, ...database.map(s => s.active)), peakLockWaiting: Math.max(0, ...database.map(s => s.lockWaiting)) },
    billing, samples,
  };
  results.push(result); save();
  console.log(JSON.stringify({ stage, requests: result.requests, rps: +result.actualRps.toFixed(2), p95: result.latencyMs.p95, errors: result.errorRate, billing: billing.passed }));
  await cleanupFixture(fixture);
  assert(billing.passed, "Billing invariants failed; inspect saved aggregate counters.");
  await delay(250);
}
async function main() {
  for (const url of [origin, upstream]) assert(await fetch(url, { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true), "Performance ports must be free.");
  await db.$queryRaw`SELECT 1`;
  const provider = child(["scripts/performance-provider.mjs"]); await ready(`${upstream}/health`, provider);
  const gateway = child(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3190"]);
  await ready(`${origin}/api/auth/session`, gateway);
  if (process.platform === "win32") {
    const sampler = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/performance-sample.ps1"), "-GatewayPid", String(gateway.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    children.push(sampler); let buffer = "";
    sampler.stdout?.on("data", data => { buffer += String(data); let index: number; while ((index = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1); try { resources.push(JSON.parse(line)); } catch {} } });
  }
  databaseLoop = (async () => { while (databaseSampling) {
    try {
      const rows = await db.$queryRaw<{ total: number; active: number; lockWaiting: number; idleInTransaction: number }[]>`
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state = 'active')::int AS active,
          COUNT(*) FILTER (WHERE wait_event_type = 'Lock')::int AS "lockWaiting",
          COUNT(*) FILTER (WHERE state = 'idle in transaction')::int AS "idleInTransaction"
        FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`;
      databaseSamples.push({ timestampMs: Date.now(), ...rows[0] });
    } catch { serverErrors.databaseSamplerFailure = (serverErrors.databaseSamplerFailure ?? 0) + 1; }
    await delay(1000);
  } })();
  for (const mode of modes) for (const identity of identities) for (const concurrency of concurrencyLevels) await scenario(mode, identity, concurrency);
  stage = "complete";
}
async function run() {
try { await main(); }
catch (error) { stage = `failed:${stage}`; console.error(JSON.stringify({ stage, kind: error instanceof Error ? error.name : "unknown", message: "Inspect aggregate output; credentials and raw response bodies are suppressed." })); process.exitCode = 1; }
finally {
  databaseSampling = false; await databaseLoop;
  for (const handle of children.toReversed()) if (handle.exitCode === null) { const exited = once(handle, "exit"); handle.kill(); await Promise.race([exited, delay(5000)]); }
  try {
    await db.user.deleteMany({ where: { id: { in: allUserIds } } });
    await db.model.deleteMany({ where: { id: { in: allModelIds } } });
    await db.providerChannel.deleteMany({ where: { id: { in: allChannelIds } } });
    await risk.cleanup();
    cleanupVerified = !await db.user.count({ where: { id: { in: allUserIds } } }) && !await db.model.count({ where: { id: { in: allModelIds } } }) && !await db.providerChannel.count({ where: { id: { in: allChannelIds } } });
  } catch { console.error("Own fixture cleanup failed; no secrets printed."); process.exitCode = 1; }
  await db.$disconnect(); save();
  console.log(`Performance ${label}: ${results.length} scenarios; cleanup=${cleanupVerified}; output=work/performance/${label}.json`);
}
}
void run().catch(() => { console.error("Performance harness failed; details suppressed."); process.exitCode = 1; });
