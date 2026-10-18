"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { latestReadRequests } from "@/lib/client/latest-read";
import { requestSignal } from "@/lib/client/request-signal";
export function useAnalytics<T, Q extends object>(initialData: T, initialQuery: Q, endpoint: string) {
  const [data, setData] = useState(initialData), [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const reads = useRef<ReturnType<typeof latestReadRequests> | null>(null);
  if (!reads.current) reads.current = latestReadRequests();
  useEffect(() => { const requests = reads.current; return () => requests?.cancel(); }, []);
  // Payment confirmation must supersede an earlier read, even for the same URL.
  const refreshAfterPayment = useEffectEvent(() => { void load(query, true); });
  useEffect(() => {
    window.addEventListener("aihub:payment-confirmed", refreshAfterPayment);
    return () => window.removeEventListener("aihub:payment-confirmed", refreshAfterPayment);
  }, []);
  function load(nextQuery: Q, force = false) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(nextQuery)) if (value !== undefined) params.set(key, String(value));
    return reads.current!.run(`${endpoint}?${params}`, async signal => {
      setQuery(nextQuery); setLoading(true); setError("");
      const request = requestSignal(30000, signal);
      try {
        const response = await fetch(`${endpoint}?${params}`, { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Your session has ended. Sign in again." : response.status === 400 ? "Invalid filters. Clear the filters and try again." : "We couldn’t load your data. Please try again.");
        const result = await response.json() as T;
        if (signal.aborted) return;
        if (request.timedOut) throw new Error("Request timed out.");
        // Let Next copy its own router state and synchronize search parameters.
        setData(result); window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
      } catch (failure) {
        if (!signal.aborted) setError(request.timedOut ? "Loading took too long. Check your connection and try again." : failure instanceof Error && !["AbortError", "TimeoutError", "TypeError"].includes(failure.name) ? failure.message : "We couldn’t connect. Please try again.");
      } finally { request.dispose(); if (!signal.aborted) setLoading(false); }
    }, force);
  }
  return { data, query, loading, error, load, retry: () => load(query, true) };
}
