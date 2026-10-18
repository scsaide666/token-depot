import "server-only";
import { readLimitedJson } from "../http";
import { GatewayError, providerError, streamError, type AIProvider, type ChatCompletionInput, type NormalizedCompletion, type NormalizedStreamChunk, type ProviderContext, type ProviderStream, type TokenUsage } from "../types";
import { normalizeProviderError } from "./errors";
import { readSse, StreamRedactor, type SseEvent } from "./sse";
import { providerBaseUrl, upstreamFetch } from "@/lib/security/upstream";
import type { ModelProvider } from "@/generated/prisma/client";

export type ProviderConfig = { apiKey?: string; baseUrl?: string; timeoutMs?: string };
export type ProviderRequest = { path: string; query?: Record<string, string>; headers: Record<string, string>; body: Record<string, unknown> };

export abstract class JsonProvider implements AIProvider {
  protected readonly apiKey: string;
  private readonly base: URL;
  private readonly timeoutMs: number;

  constructor(config: ProviderConfig, provider: ModelProvider) {
    if (!config.apiKey?.trim() || /[\r\n]/.test(config.apiKey)) throw new GatewayError(503, "This model's provider is not configured.", "server_error", "provider_not_configured");
    let base: URL;
    try { base = providerBaseUrl(config.baseUrl ?? "", provider); } catch { throw new GatewayError(503, "This model's provider is not configured.", "server_error", "provider_not_configured"); }
    this.apiKey = config.apiKey.trim(); this.base = base;
    const timeout = Number(config.timeoutMs ?? "90000");
    this.timeoutMs = Number.isInteger(timeout) && timeout >= 100 && timeout <= 120000 ? timeout : 90000;
  }

  protected abstract prepareRequest(input: ChatCompletionInput, context: ProviderContext): ProviderRequest;
  protected abstract normalizeStream(events: AsyncIterable<SseEvent>): AsyncGenerator<NormalizedStreamChunk>;
  protected prepareStreamRequest(input: ChatCompletionInput, context: ProviderContext): ProviderRequest {
    const prepared = this.prepareRequest(input, context);
    return { ...prepared, body: { ...prepared.body, stream: true, stream_options: { include_usage: true } } };
  }
  abstract normalizeResponse(response: unknown): NormalizedCompletion;
  abstract normalizeUsage(response: unknown): TokenUsage;

  async chatCompletion(input: ChatCompletionInput, context: ProviderContext): Promise<NormalizedCompletion> {
    let prepared: ProviderRequest;
    try { prepared = this.prepareRequest(input, context); }
    catch (error) {
      const safe = error instanceof GatewayError ? error : providerError();
      throw new GatewayError(safe.status, safe.message, safe.type, safe.code, safe.retryAfter, safe.usage, { execution: "NOT_SENT" });
    }
    if (context.signal.aborted) throw new GatewayError(499, "The request was cancelled.", "invalid_request_error", "request_cancelled", undefined, undefined, { execution: "NOT_SENT" });
    const endpoint = new URL(this.base);
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${prepared.path}`;
    const deadline = AbortSignal.timeout(this.timeoutMs), signal = AbortSignal.any([context.signal, deadline]);
    try {
      const response = await upstreamFetch(endpoint, {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...prepared.headers, ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}) }, body: JSON.stringify(prepared.body),
      });
      if (!response.ok) {
        let errorBody: unknown;
        if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
          try { errorBody = await readLimitedJson(response, 32 * 1024, signal); } catch { /* Status alone remains sufficient for a safe error. */ }
        } else void response.body?.cancel().catch(() => {});
        const safe = this.normalizeError(response.status, errorBody);
        let usage: TokenUsage | undefined;
        try { usage = this.normalizeUsage(errorBody); } catch { /* Unknown usage must stay unknown. */ }
        const root = errorBody && typeof errorBody === "object" ? errorBody as Record<string, unknown> : {};
        const detail = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
        const rateRejection = response.status === 429 && (!usage || usage.totalTokens === 0)
          && (!Object.hasOwn(root, "usage") || usage?.totalTokens === 0)
          && (!Object.hasOwn(root, "usageMetadata") || usage?.totalTokens === 0)
          && !["usage", "usageMetadata"].some(field => Object.hasOwn(detail, field))
          && !["choices", "candidates", "content", "response"].some(field => Object.hasOwn(root, field))
          && ["rate_limit_exceeded", "rate_limit_error", "RESOURCE_EXHAUSTED"].some((code) => [detail.code, detail.type, detail.status].includes(code));
        const retry = response.headers.get("retry-after");
        const seconds = retry && /^\d{1,5}$/.test(retry) ? Math.min(300, Math.max(1, Number(retry))) : safe.retryAfter;
        throw new GatewayError(safe.status, safe.message, safe.type, safe.code, seconds, usage,
          { execution: rateRejection ? "REJECTED" : "UNCERTAIN", upstreamStatus: response.status });
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) { void response.body?.cancel().catch(() => {}); throw providerError(); }
      return this.normalizeResponse(await readLimitedJson(response, 4 * 1024 * 1024, signal));
    } catch (error) {
      if (deadline.aborted) throw new GatewayError(504, "The upstream provider timed out.", "server_error", "provider_timeout", undefined, undefined, { execution: "UNCERTAIN" });
      if (context.signal.aborted) throw new GatewayError(499, "The request was cancelled.", "invalid_request_error", "request_cancelled", undefined, undefined, { execution: "UNCERTAIN" });
      const safe = error instanceof GatewayError ? error : providerError();
      throw new GatewayError(safe.status, safe.message, safe.type, safe.code, safe.retryAfter, safe.usage, safe.providerFailure ?? { execution: "UNCERTAIN" });
    }
  }

  async streamChatCompletion(input: ChatCompletionInput, context: ProviderContext): Promise<ProviderStream> {
    let prepared: ProviderRequest;
    try { prepared = this.prepareStreamRequest(input, context); }
    catch (error) {
      const safe = error instanceof GatewayError ? error : providerError();
      throw new GatewayError(safe.status, safe.message, safe.type, safe.code, safe.retryAfter, safe.usage, { execution: "NOT_SENT" });
    }
    const endpoint = new URL(this.base);
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${prepared.path}`;
    for (const [name, value] of Object.entries(prepared.query ?? {})) endpoint.searchParams.set(name, value);
    const deadline = AbortSignal.timeout(this.timeoutMs), cancellation = new AbortController();
    const signal = AbortSignal.any([context.signal, deadline, cancellation.signal]);
    let usage: TokenUsage | undefined;
    const iterator = (async function* (this: JsonProvider) {
      const content = new StreamRedactor(this.apiKey), refusal = new StreamRedactor(this.apiKey);
      try {
        if (signal.aborted) throw new GatewayError(499, "The request was cancelled.", "invalid_request_error", "request_cancelled", undefined, undefined, { execution: "NOT_SENT" });
        const response = await upstreamFetch(endpoint, { method: "POST", redirect: "error", cache: "no-store", signal,
          headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...prepared.headers,
            ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}) }, body: JSON.stringify(prepared.body) });
        if (!response.ok) {
          let body: unknown;
          try { if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) body = await readLimitedJson(response, 32768, signal); }
          catch { /* Keep the bounded safe HTTP classification. */ }
          finally { await response.body?.cancel().catch(() => {}); }
          const safe = this.normalizeError(response.status, body);
          try { usage = this.normalizeUsage(body); } catch { /* Unknown cost stays unknown. */ }
          const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
          const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
          const rejected = response.status === 429 && (!usage || usage.totalTokens === 0)
            && (!Object.hasOwn(root, "usage") || usage?.totalTokens === 0) && (!Object.hasOwn(root, "usageMetadata") || usage?.totalTokens === 0)
            && !["usage", "usageMetadata"].some(name => Object.hasOwn(error, name))
            && !["choices", "candidates", "content", "response"].some(name => Object.hasOwn(root, name))
            && ["rate_limit_exceeded", "rate_limit_error", "RESOURCE_EXHAUSTED"].some(code => [error.code, error.type, error.status].includes(code));
          const retry = response.headers.get("retry-after"), seconds = retry && /^\d{1,5}$/.test(retry) ? Math.min(300, Math.max(1, Number(retry))) : safe.retryAfter;
          throw new GatewayError(safe.status, safe.message, safe.type, safe.code, seconds, usage, { execution: rejected ? "REJECTED" : "UNCERTAIN", upstreamStatus: response.status });
        }
        if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) { await response.body?.cancel().catch(() => {}); throw streamError(); }
        for await (const chunk of this.normalizeStream(readSse(response, signal))) {
          if (chunk.usage) usage = chunk.usage;
          const delta = { ...chunk.delta };
          if (delta.content !== undefined) delta.content = content.push(delta.content);
          if (delta.refusal !== undefined) delta.refusal = refusal.push(delta.refusal);
          if (chunk.complete) {
            const tail = content.flush(), refused = refusal.flush();
            if (tail || refused) yield { delta: { ...(tail ? { content: tail } : {}), ...(refused ? { refusal: refused } : {}) }, usage };
          }
          if (delta.role || delta.content || delta.refusal || chunk.complete || chunk.usage) yield { ...chunk, delta };
        }
      } catch (error) {
        const safe = error instanceof GatewayError ? error : streamError();
        if (deadline.aborted) throw new GatewayError(504, "The upstream provider timed out.", "server_error", "provider_timeout", undefined, safe.usage ?? usage, { execution: "UNCERTAIN" });
        if (context.signal.aborted || cancellation.signal.aborted) throw new GatewayError(499, "The request was cancelled.", "invalid_request_error", "request_cancelled", undefined, safe.usage ?? usage, { execution: "UNCERTAIN" });
        throw new GatewayError(safe.status, safe.message, safe.type, safe.code, safe.retryAfter, safe.usage ?? usage, safe.providerFailure ?? { execution: "UNCERTAIN" });
      } finally { cancellation.abort(); }
    }).call(this);
    // The deadline must terminate transport/settlement even when the consumer is
    // backpressured at a yield. Cleanup cancellation is intentionally excluded.
    return Object.defineProperties(iterator, {
      signal: { value: AbortSignal.any([context.signal, deadline]) }, usage: { get: () => usage },
    });
  }
  normalizeError(status?: number, response?: unknown) { return normalizeProviderError(status, response); }
  protected redact(value: string | null) {
    if (value === null) return null;
    const redactor = new StreamRedactor(this.apiKey);
    return redactor.push(value) + redactor.flush();
  }
}
