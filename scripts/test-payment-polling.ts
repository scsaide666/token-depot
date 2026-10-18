import assert from "node:assert/strict";
import { createPaymentPoller, PAYMENT_POLL_INTERVAL_MS, PAYMENT_POLL_LIMIT_MS } from "../lib/payment-polling";
import type { PaymentStatusData, PaymentStatus } from "../lib/payment-types";

type Timer = ReturnType<typeof setTimeout>;
function fakeClock() {
  let time = 0, serial = 0;
  const tasks = new Map<number, { action: () => void; at: number }>();
  const clock = {
    now: () => time,
    set: (action: () => void, delay: number) => { const id = ++serial; tasks.set(id, { action, at: time + delay }); return id as unknown as Timer; },
    clear: (id: Timer) => { tasks.delete(id as unknown as number); },
  };
  async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  async function advance(delta: number) {
    const end = time + delta;
    await flush();
    while (true) {
      const due = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      time = due[1].at; tasks.delete(due[0]); due[1].action(); await flush();
    }
    time = end; await flush();
  }
  return { clock, advance, flush, pending: () => tasks.size };
}
function fixture(status: PaymentStatus = "PENDING", remaining = 900000): PaymentStatusData {
  const serverTime = new Date("2026-10-06T00:00:00Z");
  return {
    order: { id: "fixture", orderNo: "AHfixture", method: "ALIPAY", status, amount: "50.00", currency: "CNY", creditAmount: "50.00", walletCurrency: "CNY", createdAt: serverTime.toISOString(), expiresAt: new Date(serverTime.getTime() + remaining).toISOString(), paidAt: status === "PAID" ? serverTime.toISOString() : null },
    availableBalance: "32.43", reservedBalance: "0.00", serverTime: serverTime.toISOString(), qrCodeDataUrl: null,
  };
}
let passed = 0;
async function check(name: string, action: () => Promise<void>) { await action(); passed++; console.log(`PASS ${name}`); }

async function main() {
  for (const status of ["PAID", "FAILED", "CLOSED", "REFUNDED"] as const) {
    await check(`Polling stops immediately at ${status}`, async () => {
      const time = fakeClock(), stops: string[] = [], data: PaymentStatusData[] = [];
      let reads = 0;
      const poller = createPaymentPoller({ initial: fixture(), clock: time.clock, read: async () => { reads++; return fixture(status); }, onData: (result) => data.push(result), onError: () => assert.fail(), onStop: (reason) => stops.push(reason) });
      poller.start(); await time.advance(PAYMENT_POLL_LIMIT_MS + 10000);
      assert.equal(reads, 1); assert.deepEqual(stops, ["terminal"]); assert.equal(data[0].order.status, status); assert.equal(time.pending(), 0); poller.dispose();
    });
  }
  await check("Polling interval is 2.5 seconds and has a hard five-minute limit", async () => {
    const time = fakeClock(), stops: string[] = []; let reads = 0;
    const poller = createPaymentPoller({ initial: fixture(), clock: time.clock, read: async () => { reads++; return fixture(); }, onData: () => {}, onError: () => assert.fail(), onStop: (reason) => stops.push(reason) });
    poller.start(); await time.flush(); assert.equal(reads, 1);
    await time.advance(PAYMENT_POLL_INTERVAL_MS - 1); assert.equal(reads, 1);
    await time.advance(1); assert.equal(reads, 2);
    await time.advance(PAYMENT_POLL_LIMIT_MS); assert.equal(reads, 120); assert.deepEqual(stops, ["timeout"]); assert.equal(time.pending(), 0);
    await poller.refresh(); assert.equal(reads, 121); await time.advance(PAYMENT_POLL_LIMIT_MS); assert.equal(reads, 121); poller.dispose();
  });
  await check("Expiry uses server time and never fabricates a PAID status", async () => {
    const time = fakeClock(), stops: string[] = []; let reads = 0;
    const poller = createPaymentPoller({ initial: fixture("PENDING", 5000), clock: time.clock, read: async () => { reads++; return fixture(); }, onData: (data) => assert.equal(data.order.status, "PENDING"), onError: () => assert.fail(), onStop: (reason) => stops.push(reason) });
    poller.start(); await time.advance(5000); assert.equal(reads, 2); assert.deepEqual(stops, ["expired"]); assert.equal(time.pending(), 0); poller.dispose();
    const expired = createPaymentPoller({ initial: fixture("PENDING", 0), clock: time.clock, read: async () => assert.fail(), onData: () => assert.fail(), onError: () => assert.fail(), onStop: (reason) => assert.equal(reason, "expired") }); expired.start(); expired.dispose();
  });
  await check("Closing the page aborts the request, ignores late replies and clears timers", async () => {
    const time = fakeClock(); let signal: AbortSignal | undefined, finish: ((data: PaymentStatusData) => void) | undefined;
    const poller = createPaymentPoller({ initial: fixture(), clock: time.clock, read: (value) => { signal = value; return new Promise((resolve) => { finish = resolve; }); }, onData: () => assert.fail(), onError: () => assert.fail(), onStop: () => assert.fail() });
    poller.start(); assert.equal(signal?.aborted, false); poller.dispose(); assert.equal(signal?.aborted, true); finish!(fixture("PAID")); await time.advance(PAYMENT_POLL_LIMIT_MS * 2); assert.equal(time.pending(), 0);
  });
  await check("Slow requests cannot overlap and are aborted at the deadline", async () => {
    const time = fakeClock(); let reads = 0, signal: AbortSignal | undefined;
    const poller = createPaymentPoller({ initial: fixture(), clock: time.clock, read: (value) => { reads++; signal = value; return new Promise(() => {}); }, onData: () => assert.fail(), onError: () => assert.fail(), onStop: (reason) => assert.equal(reason, "timeout") });
    poller.start(); void poller.refresh(); await time.advance(PAYMENT_POLL_LIMIT_MS); assert.equal(reads, 1); assert.equal(signal?.aborted, true); assert.equal(time.pending(), 0); poller.dispose();
  });
  await check("Network errors retry within the same finite budget", async () => {
    const time = fakeClock(); let errors = 0, reads = 0;
    const poller = createPaymentPoller({ initial: fixture(), clock: time.clock, read: async () => { reads++; throw new Error("Offline"); }, onData: () => assert.fail(), onError: () => errors++, onStop: (reason) => assert.equal(reason, "timeout") });
    poller.start(); await time.advance(PAYMENT_POLL_LIMIT_MS * 2); assert.equal(reads, 120); assert.equal(errors, reads); assert.equal(time.pending(), 0); poller.dispose();
  });
  await check("Orders already in a terminal state never start polling", async () => {
    const time = fakeClock();
    const poller = createPaymentPoller({ initial: fixture("PAID"), clock: time.clock, read: async () => assert.fail(), onData: () => assert.fail(), onError: () => assert.fail(), onStop: (reason) => assert.equal(reason, "terminal") });
    poller.start(); await poller.refresh(); await time.advance(PAYMENT_POLL_LIMIT_MS); assert.equal(time.pending(), 0); poller.dispose();
  });
  await check("Manual confirmation aborts in-flight polling and ignores stale or foreign replies", async () => {
    const time = fakeClock(), states: PaymentStatus[] = []; let signal: AbortSignal | undefined, finish: ((data: PaymentStatusData) => void) | undefined;
    const poller = createPaymentPoller({ initial: fixture(), clock: time.clock, read: (value) => { signal = value; return new Promise((resolve) => { finish = resolve; }); }, onData: (data) => states.push(data.order.status), onError: () => assert.fail(), onStop: () => {} });
    poller.start(); poller.accept(fixture("PAID")); assert.equal(signal?.aborted, true);
    finish!(fixture()); poller.accept(fixture("CLOSED")); poller.accept({ ...fixture("PAID"), order: { ...fixture("PAID").order, id: "another-order" } });
    await time.advance(PAYMENT_POLL_LIMIT_MS * 2); assert.deepEqual(states, ["PAID"]); assert.equal(time.pending(), 0); poller.dispose();
  });
  console.log(`Payment polling checks: ${passed} passed (fake clock; no payment provider calls).`);
}
main().catch(() => { console.error("Payment polling checks failed."); process.exitCode = 1; });
