import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { ApiRequestSource, ModelProvider, UserStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/server/db";
import { gatewayModel } from "@/lib/server/model-cache";
import { requireApiSession } from "@/lib/server/http";
import { readLimitedJson } from "./http";
import { authenticateApiKey } from "./router/authenticate";
import { prepareRoute, executeRoute, openStreamRoute } from "./router/channels";
import { streamResponse } from "./stream-response";
import { gatewayRiskError, limitGatewayEdge, limitGatewayIdentity, limitGatewayRequest, limitInvalidKey } from "./router/rate-limit";
import { CHAT_LIMITS } from "./types/limits";
import { estimateBudget } from "@/lib/billing/budget";
import { requestIpHash } from "@/lib/risk/identity";
import { finishRisk, RiskLimited, type RiskPermit } from "@/lib/risk/limiter";
import { recordBehavior } from "@/lib/risk/behavior";
import { riskLog } from "@/lib/risk/log";
import { RiskUnavailable } from "@/lib/risk/redis";
import { chatCompletionSchema, GatewayError, type TokenUsage } from "./types";
import { reserveRequest, settleFailure, settleSuccess } from "@/lib/billing/wallet";

async function readInput(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new GatewayError(415, "Use Content-Type: application/json.", "invalid_request_error", "invalid_request");
  let body: unknown;
  try { body = await readLimitedJson(request, CHAT_LIMITS.bodyBytes, AbortSignal.any([request.signal, AbortSignal.timeout(10000)])); }
  catch (error) {
    const oversized = error instanceof Error && error.message === "body_limit";
    throw new GatewayError(oversized ? 413 : 400, oversized ? "Request body is too large." : "Invalid JSON request body.", "invalid_request_error", "invalid_request");
  }
  const parsed = chatCompletionSchema.safeParse(body);
  if (!parsed.success) throw new GatewayError(400, "Invalid chat completion parameters.", "invalid_request_error", "invalid_request");
  return parsed.data;
}

type GatewayIdentity = { userId: string; apiKeyId: string | null; apiKeyPrefix?: string; userStatus: UserStatus; source?: ApiRequestSource };

// The optional context is server-only. The public API route cannot select Session
// authentication through a header or body field. Ownership is checked again here.
export async function handleChatCompletion(request: Request, context?: { playgroundRunId: string }) {
  const requestId = context?.playgroundRunId ?? randomUUID(), startedAt = performance.now();
  let identity: GatewayIdentity | undefined;
  let modelId: string | null = null, provider: ModelProvider | null = null;
  let held = false, upstreamStarted = false, usage: TokenUsage | undefined;
  let permit: RiskPermit | undefined, ipHash: string | undefined, modelSlug: string | undefined, cost: string | undefined;
  let responseBody: unknown, failure: GatewayError | undefined;
  let streamSignal: AbortSignal | undefined;
  try {
    if (context) {
      const session = await requireApiSession();
      const run = await getDb().playgroundRun.findFirst({ where: { id: context.playgroundRunId, userId: session.user.id }, select: { id: true } });
      if (!run) throw new GatewayError(404, "Request not found.", "invalid_request_error", "request_not_found");
      identity = { userId: session.user.id, apiKeyId: null, userStatus: session.user.status, source: "PLAYGROUND" };
    }
    try { ipHash = requestIpHash(request); } catch { throw new RiskUnavailable(); }
    await limitGatewayEdge(ipHash, requestId);
    try { identity ??= await authenticateApiKey(request); }
    catch (error) {
      if (error instanceof GatewayError && error.code === "invalid_api_key") {
        await recordBehavior("invalid_api_key", { ipHash, requestId });
        await limitInvalidKey(ipHash, requestId);
      }
      throw error;
    }
    if (identity.userStatus !== "ACTIVE") throw new GatewayError(403, "This account is suspended.", "permission_error", "account_suspended");
    await limitGatewayIdentity(identity, requestId);
    const input = await readInput(request);
    const model = await gatewayModel(input.model);
    if (!model || !model.enabled) throw new GatewayError(404, "Model not found", "invalid_request_error", "model_not_found");
    modelId = model.id; provider = model.provider; modelSlug = model.slug;
    const estimate = estimateBudget(input, model);
    permit = await limitGatewayRequest(identity, ipHash, requestId, estimate.estimatedInputTokens + estimate.maxOutputTokens);
    const plan = await prepareRoute(model);
    const budget = await reserveRequest(requestId, identity, model, input);
    held = true;
    if (input.stream) {
      const cancellation = new AbortController();
      streamSignal = cancellation.signal;
      const cancel = () => cancellation.abort(); request.signal.addEventListener("abort", cancel, { once: true });
      if (request.signal.aborted) cancellation.abort();
      try {
        const route = await openStreamRoute(plan, budget.boundedInput, { requestId, signal: cancellation.signal,
          estimatedTokens: budget.estimatedInputTokens + budget.maxOutputTokens, onDispatch: () => { upstreamStarted = true; } });
        const streaming = streamResponse(route, input, requestId, cancellation, finalize);
        after(async () => { await streaming.completion; request.signal.removeEventListener("abort", cancel); });
        return streaming.response;
      } catch (error) { cancellation.abort(); request.signal.removeEventListener("abort", cancel); throw error; }
    }
    const result = await executeRoute(plan, budget.boundedInput, { requestId, signal: request.signal,
      estimatedTokens: budget.estimatedInputTokens + budget.maxOutputTokens, onDispatch: () => { upstreamStarted = true; } });
    usage = result.usage;
    responseBody = {
      id: `chatcmpl-${requestId}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: input.model,
      choices: result.choices,
      usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens },
    };
  } catch (error) {
    failure = gatewayRiskError(error) ?? (error instanceof GatewayError ? error : new GatewayError(500, "The gateway could not complete this request.", "server_error", "gateway_error"));
    usage = failure.usage;
    if (error instanceof RiskLimited) {
      riskLog({ event: "rate_limit", requestId, userId: identity?.userId, apiKeyPrefix: identity?.apiKeyPrefix, ipHash, endpoint: "chat-completions", reason: `${error.scope}_${error.reason}`, status: 429 });
      if (error.reason === "concurrency" && ipHash) await recordBehavior("concurrent_burst", { requestId, userId: identity?.userId, apiKeyPrefix: identity?.apiKeyPrefix, ipHash });
    }
  }
  async function finalize(outcome?: { error?: GatewayError; usage?: TokenUsage }) {
    if (outcome) { failure = outcome.error; usage = outcome.usage; }
    if (identity) {
      const authenticated = identity;
      try {
        if (held) {
          const latencyMs = performance.now() - startedAt;
          const settled = failure
            ? await settleFailure(authenticated.userId, requestId, failure.code, latencyMs, usage, failure.providerFailure?.execution === "NOT_SENT")
            : await settleSuccess(authenticated.userId, requestId, usage!, latencyMs, streamSignal);
          cost = settled.userCost?.toFixed(20);
          if (!failure && settled.status !== "SUCCESS") failure = new GatewayError(500, "The upstream usage could not be settled within the request budget.", "server_error", settled.errorCode ?? "billing_error");
        } else {
          // Rejections before a hold preserve metadata, but never create a charge.
          await getDb().apiRequest.create({ data: {
            requestId, userId: authenticated.userId, apiKeyId: authenticated.apiKeyId, source: authenticated.source ?? "API", modelId, provider,
            inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
            status: failure ? "FAILED" : "SUCCESS", errorCode: failure?.code ?? null,
            latencyMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - startedAt))),
          } });
        }
      } catch { failure = new GatewayError(503, "The billing settlement could not be confirmed.", "server_error", "billing_unavailable"); }
    }
    // Financial settlement must finish independently of Redis cleanup. On an outage,
    // the expiring lease remains conservative and never causes a second wallet charge.
    if (permit) {
      try { await finishRisk(permit, usage?.totalTokens ?? (upstreamStarted ? permit.budget : 0)); }
      catch { riskLog({ event: "risk_unavailable", requestId, userId: identity?.userId, ipHash, reason: "lease_cleanup_failed" }); }
    }
    if (failure && ipHash) {
      await recordBehavior("failed_requests", { requestId, userId: identity?.userId, apiKeyPrefix: identity?.apiKeyPrefix, ipHash });
      if (upstreamStarted && ["provider_unavailable", "provider_timeout", "provider_rate_limit", "provider_auth_error"].includes(failure.code)) await recordBehavior("provider_failures", { requestId, userId: identity?.userId, ipHash }, provider ?? "unknown");
    }
    riskLog({ event: "api_request", requestId, userId: identity?.userId, apiKeyPrefix: identity?.apiKeyPrefix, ipHash, model: modelSlug,
      endpoint: "chat-completions", status: failure?.status ?? 200, latencyMs: Math.round(performance.now() - startedAt), tokens: usage?.totalTokens, cost });
    return failure;
  }
  await finalize();
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId };
  if (failure?.status === 401) headers["WWW-Authenticate"] = "Bearer";
  if (failure?.retryAfter) headers["Retry-After"] = String(failure.retryAfter);
  return Response.json(failure ? { error: { message: failure.message, type: failure.type, code: failure.code } } : responseBody, { status: failure?.status ?? 200, headers });
}
