import "server-only";
import { finishAttempt } from "./router/attempts";
import type { StreamRoute } from "./router/channels";
import { GatewayError, streamError, type ChatCompletionInput, type NormalizedStreamChunk, type TokenUsage } from "./types";

export function streamResponse(route: StreamRoute, input: ChatCompletionInput, requestId: string, cancelUpstream: AbortController,
  finalize: (outcome: { error?: GatewayError; usage?: TokenUsage }) => Promise<GatewayError | undefined>) {
  const encoder = new TextEncoder(), iterator = route.result.iterator, created = Math.floor(Date.now() / 1000);
  const signal = route.result.source.signal ? AbortSignal.any([route.signal, route.result.source.signal]) : route.signal;
  let first: NormalizedStreamChunk | undefined = route.result.first, usage: TokenUsage | undefined;
  let closed = false, complete = false, finishReason: NormalizedStreamChunk["finishReason"], settlement: Promise<GatewayError | undefined> | undefined;
  let terminationError: GatewayError | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveCompletion: () => void;
  const completion = new Promise<void>(resolve => { resolveCompletion = resolve; });
  const frame = (value: unknown) => encoder.encode(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`);
  const chunk = (delta: NormalizedStreamChunk["delta"], reason: NormalizedStreamChunk["finishReason"] | null = null) => ({
    id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created, model: input.model,
    choices: [{ index: 0, delta, finish_reason: reason }], ...(input.stream_options?.include_usage ? { usage: null } : {}),
  });
  function settle(error?: GatewayError) {
    if (!settlement) settlement = (async () => {
      let failure = error;
      usage ??= route.result.source.usage;
      try { await finishAttempt(route.claim, performance.now() - route.started, { error: failure, usage }); }
      catch { failure = new GatewayError(503, "The streaming settlement could not be confirmed.", "server_error", "billing_unavailable"); }
      try { return await finalize({ error: terminationError ?? failure, usage }); }
      finally { resolveCompletion!(); signal.removeEventListener("abort", abort); }
    })();
    return settlement;
  }
  async function stop(error: GatewayError, emit: boolean) {
    if (closed) return;
    terminationError = error;
    closed = true; cancelUpstream.abort();
    usage ??= route.result.source.usage;
    await iterator.return?.().catch(() => {});
    usage ??= route.result.source.usage;
    const failure = await settle(error);
    if (controller) {
      try {
        if (emit) controller.enqueue(frame({ error: { message: (failure ?? error).message, type: (failure ?? error).type, code: (failure ?? error).code } }));
        controller.close();
      } catch { /* The client has already disconnected. */ }
    }
  }
  function abort() {
    const timeout = !cancelUpstream.signal.aborted;
    const error = new GatewayError(timeout ? 504 : 499, timeout ? "The upstream provider timed out." : "The request was cancelled.",
      timeout ? "server_error" : "invalid_request_error", timeout ? "provider_timeout" : "request_cancelled", undefined, usage, { execution: "UNCERTAIN", outputStarted: true });
    void stop(error, timeout).catch(() => { resolveCompletion!(); });
  }
  signal.addEventListener("abort", abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; if (signal.aborted) abort(); },
    async pull(value) {
      if (closed) return;
      try {
        for (;;) {
          const next = first ? { value: first, done: false as const } : await iterator.next(); first = undefined;
          if (closed) return;
          if (!next.done) {
            const event = next.value;
            if (event.usage) usage = event.usage;
            if (event.complete) { complete = true; finishReason = event.finishReason; }
            else if (event.delta.role || event.delta.content || event.delta.refusal) { value.enqueue(frame(chunk(event.delta))); return; }
            // The completion marker is internal until the adapter finishes and the
            // database confirms settlement. Never emit a misleading successful end.
            if (!event.complete) continue;
            const end = await iterator.next(); if (!end.done) throw streamError();
          }
          if (!complete || !usage || !finishReason) throw streamError("usage_missing");
          const failure = await settle();
          if (closed) return;
          closed = true;
          if (failure) value.enqueue(frame({ error: { message: failure.message, type: failure.type, code: failure.code } }));
          else {
            value.enqueue(frame(chunk({}, finishReason)));
            if (input.stream_options?.include_usage) value.enqueue(frame({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created, model: input.model, choices: [],
              usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens } }));
            value.enqueue(frame("[DONE]"));
          }
          value.close();
          return;
        }
      } catch (error) {
        const safe = error instanceof GatewayError ? error : streamError();
        if (safe.usage) usage = safe.usage;
        await stop(safe, true);
      }
    },
    async cancel() { await stop(new GatewayError(499, "The request was cancelled.", "invalid_request_error", "request_cancelled", undefined, usage, { execution: "UNCERTAIN", outputStarted: true }), false); },
  }, { highWaterMark: 1 });
  return { completion, response: new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } }) };
}
