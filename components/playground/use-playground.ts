"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaygroundMessage, PlaygroundStats } from "@/lib/playground-types";
import { PlaygroundError, readPlaygroundStream, responseError } from "@/lib/playground-stream";
import { completedContext } from "@/lib/playground-conversation";

type Input = { model: string; system: string; temperature?: number; max_tokens: number; content: string };
export function usePlayground(initialBalance: string) {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [phase, setPhase] = useState<"idle" | "generating" | "stopping" | "settling">("idle");
  const [error, setError] = useState<PlaygroundError | null>(null);
  const [stats, setStats] = useState<PlaygroundStats | null>(null);
  const [balance, setBalance] = useState(initialBalance);
  const active = useRef(false), mounted = useRef(true), stopped = useRef(false);
  const generation = useRef<AbortController | null>(null), statistics = useRef<AbortController | null>(null);
  const history = useRef<PlaygroundMessage[]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current?.abort(); statistics.current?.abort(); };
  }, []);
  const update = useCallback((rows: PlaygroundMessage[]) => { history.current = rows; if (mounted.current) setMessages(rows); }, []);
  const stop = useCallback(() => { if (active.current) { stopped.current = true; setPhase("stopping"); generation.current?.abort(); } }, []);
  const clear = useCallback(() => { if (!active.current) { update([]); setError(null); setStats(null); } }, [update]);

  async function send(input: Input) {
    // Synchronous guard covers double clicks and keyboard submits before React renders.
    if (active.current || !input.content.trim()) return false;
    const context = completedContext(history.current);
    if (context.length + (input.system.trim() ? 2 : 1) > 64) {
      setError(new PlaygroundError("This conversation is too long. Clear it before starting a new request.")); return false;
    }
    active.current = true; stopped.current = false;
    setPhase("generating"); setError(null); setStats(null);
    const controller = new AbortController(); generation.current = controller;
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 180000);
    const submissionId = crypto.randomUUID();
    const user: PlaygroundMessage = { id: crypto.randomUUID(), role: "user", content: input.content.trim() };
    const assistant: PlaygroundMessage = { id: crypto.randomUUID(), role: "assistant", content: "", state: "streaming" };
    const visible = [...history.current, user]; let text = "", requestId: string | null = null, frame = 0, complete = false, rejected = false;
    const flush = (state: PlaygroundMessage["state"] = "streaming") => { if (frame) cancelAnimationFrame(frame); frame = 0; update([...visible, { ...assistant, content: text, state }]); };
    update([...visible, assistant]);
    try {
      const response = await fetch("/api/playground", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        submissionId, model: input.model,
        messages: [...(input.system.trim() ? [{ role: "system", content: input.system }] : []), ...context.map(({ role, content }) => ({ role, content })), { role: "user", content: user.content }],
        max_tokens: input.max_tokens, ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      }) });
      requestId = response.headers.get("x-request-id");
      if (!response.ok) { rejected = true; throw await responseError(response); }
      await readPlaygroundStream(response, controller.signal, delta => { text += delta; if (!frame) frame = requestAnimationFrame(() => flush()); });
      complete = true;
    } catch (failure) {
      if (mounted.current && !stopped.current) setError(failure instanceof PlaygroundError ? failure : new PlaygroundError(controller.signal.aborted ? "The request timed out. Check Usage before sending again." : "Connection interrupted. Check Usage before sending again.", "connection_interrupted"));
    } finally {
      clearTimeout(timer); generation.current = null;
      flush(complete ? "complete" : stopped.current ? "stopped" : "failed");
      if (mounted.current && (!rejected || requestId)) {
        setPhase("settling");
        const polling = new AbortController(); statistics.current = polling;
        const deadline = Date.now() + 15000;
        let terminal = false;
        try {
          do {
            const path = requestId ? `/api/playground/runs/${encodeURIComponent(requestId)}` : `/api/playground/submissions/${submissionId}`;
            const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([polling.signal, AbortSignal.timeout(5000)]) });
            if (!response.ok && !(response.status === 404 && !requestId)) throw await responseError(response);
            if (response.ok) {
              const result: PlaygroundStats = await response.json(); requestId = result.requestId;
              if (mounted.current) { setStats(result); setBalance(result.balanceDisplay); }
              if (result.status !== "PENDING") { terminal = true; break; }
            }
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => { clearTimeout(wait); reject(polling.signal.reason); };
              const wait = setTimeout(() => { polling.signal.removeEventListener("abort", onAbort); resolve(); }, 500);
              polling.signal.addEventListener("abort", onAbort, { once: true });
              if (polling.signal.aborted) onAbort();
            });
          } while (Date.now() < deadline);
          if (!terminal) throw new PlaygroundError("Settlement is still pending. Check Usage for the final result.", "settlement_pending");
        } catch (failure) { if (mounted.current) setError(current => current ?? (failure instanceof PlaygroundError ? failure : new PlaygroundError("Could not confirm request statistics. Check Usage before sending again."))); }
        finally { statistics.current = null; }
      }
      active.current = false;
      if (mounted.current) setPhase("idle");
    }
    return !rejected;
  }
  return { messages, phase, error, stats, balance, send, stop, clear, busy: phase !== "idle" };
}
