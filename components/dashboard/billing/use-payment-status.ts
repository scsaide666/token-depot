"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPaymentPoller } from "@/lib/payment-polling";
import type { PaymentStatusData } from "@/lib/payment-types";

export function usePaymentStatus(initialData: PaymentStatusData, canQueryProvider: boolean, onPaid: () => void) {
  const [data, setData] = useState(initialData), [error, setError] = useState(""), [checking, setChecking] = useState(false);
  const [stopped, setStopped] = useState<"terminal" | "expired" | "timeout" | null>(null);
  const poller = useRef<ReturnType<typeof createPaymentPoller> | null>(null), notified = useRef(false);
  const manual = useRef<AbortController | null>(null);
  const paid = useEffectEvent(() => { onPaid(); });
  useEffect(() => {
    const instance = createPaymentPoller({ initial: initialData,
      read: async (signal) => {
        const response = await fetch(`/api/payments/${initialData.order.id}/status`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) { setError(response.status === 404 ? "This payment is no longer available." : "Your session has ended. Sign in again."); instance.dispose(); }
          throw new Error("Status unavailable.");
        }
        return await response.json() as PaymentStatusData;
      },
      onData: (next) => {
        if (next.order.id !== initialData.order.id) return;
        setData(next); setError("");
        if (next.order.status === "PAID" && !notified.current) { notified.current = true; paid(); }
      },
      onError: () => setError("We couldn’t refresh the payment status. You can try again."),
      onStop: (reason) => setStopped(reason),
    });
    poller.current = instance; instance.start();
    const leave = () => { instance.dispose(); manual.current?.abort(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pagehide", leave); window.addEventListener("pageshow", restore);
    return () => { leave(); window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restore); poller.current = null; };
  }, [initialData]);

  async function refresh() {
    if (checking) return;
    setChecking(true); setError("");
    const controller = new AbortController(); manual.current = controller;
    try {
      if (canQueryProvider && !["PAID", "REFUNDED"].includes(data.order.status)) {
        const response = await fetch(`/api/payments/${data.order.id}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error("Status unavailable.");
        if (!controller.signal.aborted) poller.current?.accept(await response.json() as PaymentStatusData);
      } else await poller.current?.refresh();
    } catch { if (!controller.signal.aborted) setError("We couldn’t confirm the payment status. Please try again."); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }
  return { data, error, checking, stopped, refresh };
}
