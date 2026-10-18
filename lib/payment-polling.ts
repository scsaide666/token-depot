import { isPaymentTerminal, type PaymentStatusData } from "./payment-types";

export const PAYMENT_POLL_INTERVAL_MS = 2500;
export const PAYMENT_POLL_LIMIT_MS = 5 * 60 * 1000;
type StopReason = "terminal" | "expired" | "timeout";
type Timer = ReturnType<typeof setTimeout>;
type Clock = { now: () => number; set: (action: () => void, delay: number) => Timer; clear: (timer: Timer) => void };
const browserClock: Clock = { now: Date.now, set: (action, delay) => setTimeout(action, delay), clear: (timer) => clearTimeout(timer) };

// Read-only polling, with a hard deadline and at most one request in flight.
// It never accepts a balance mutation or a client-provided payment outcome.
export function createPaymentPoller(options: {
  initial: PaymentStatusData;
  read: (signal: AbortSignal) => Promise<PaymentStatusData>;
  onData: (data: PaymentStatusData) => void;
  onError: () => void;
  onStop: (reason: StopReason) => void;
  clock?: Clock;
}) {
  const clock = options.clock ?? browserClock;
  const startedAt = clock.now();
  const expiresIn = Math.max(0, Date.parse(options.initial.order.expiresAt) - Date.parse(options.initial.serverTime));
  const expiresAt = startedAt + expiresIn;
  const deadline = Math.min(expiresAt, startedAt + PAYMENT_POLL_LIMIT_MS);
  let stopped = false, disposed = false, terminal = false;
  let currentStatus = options.initial.order.status;
  let next: Timer | undefined, limit: Timer | undefined;
  let active: AbortController | undefined;
  let inFlight: Promise<void> | undefined;

  function clearTimers() {
    if (next !== undefined) clock.clear(next);
    if (limit !== undefined) clock.clear(limit);
    next = undefined; limit = undefined;
  }
  function stop(reason: StopReason) {
    if (stopped || disposed) return;
    stopped = true; clearTimers(); active?.abort(); options.onStop(reason);
  }
  function accept(data: PaymentStatusData) {
    if (disposed || data.order.id !== options.initial.order.id || (terminal && !isPaymentTerminal(data.order.status))
      || (currentStatus === "PAID" && data.order.status !== "PAID")) return;
    currentStatus = data.order.status;
    if (isPaymentTerminal(data.order.status)) { terminal = true; stop("terminal"); }
    options.onData(data);
  }
  function schedule() {
    if (stopped || disposed) return;
    if (clock.now() >= deadline) { stop(expiresAt <= deadline ? "expired" : "timeout"); return; }
    next = clock.set(() => { next = undefined; void readOnce(true); }, Math.min(PAYMENT_POLL_INTERVAL_MS, deadline - clock.now()));
  }
  function readOnce(automatic: boolean): Promise<void> {
    if (disposed || (automatic && stopped)) return Promise.resolve();
    if (inFlight) return inFlight;
    if (next !== undefined) { clock.clear(next); next = undefined; }
    const controller = new AbortController(); active = controller;
    inFlight = (async () => {
      try {
        const data = await options.read(controller.signal);
        if (disposed || controller.signal.aborted) return;
        accept(data);
      } catch { if (!disposed && !controller.signal.aborted) options.onError(); }
      finally { inFlight = undefined; if (active === controller) active = undefined; schedule(); }
    })();
    return inFlight;
  }
  function start() {
    if (disposed || stopped || limit !== undefined) return;
    if (isPaymentTerminal(options.initial.order.status)) { terminal = true; stop("terminal"); return; }
    if (clock.now() >= deadline) { stop(expiresAt <= deadline ? "expired" : "timeout"); return; }
    limit = clock.set(() => stop(expiresAt <= deadline ? "expired" : "timeout"), deadline - clock.now());
    void readOnce(true);
  }
  return {
    start,
    // An explicit manual read after the five-minute limit does not restart automatic polling.
    refresh: () => terminal ? Promise.resolve() : readOnce(false),
    accept,
    dispose() { disposed = true; clearTimers(); active?.abort(); },
  };
}
