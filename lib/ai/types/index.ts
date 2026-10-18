import { z } from "zod";
import { CHAT_LIMITS } from "./limits";

export const chatCompletionSchema = z.strictObject({
  model: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/),
  messages: z.array(z.strictObject({
    role: z.enum(["developer", "system", "user", "assistant"]),
    content: z.string().max(CHAT_LIMITS.messageCharacters),
  })).min(1).max(CHAT_LIMITS.messages),
  stream: z.boolean().optional(),
  stream_options: z.strictObject({ include_usage: z.boolean().optional(), include_obfuscation: z.boolean().optional() }).optional(),
  n: z.literal(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().min(1).max(CHAT_LIMITS.outputTokens).optional(),
  max_completion_tokens: z.number().int().min(1).max(CHAT_LIMITS.outputTokens).optional(),
  stop: z.union([z.string().max(200), z.array(z.string().max(200)).min(1).max(4)]).optional(),
}).refine((value) => value.max_tokens === undefined || value.max_completion_tokens === undefined)
  .refine(value => value.stream_options === undefined || value.stream === true)
  .refine((value) => value.messages.reduce((sum, message) => sum + message.content.length, 0) <= CHAT_LIMITS.inputCharacters);

export type ChatCompletionInput = z.infer<typeof chatCompletionSchema>;
export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type CompletionChoice = {
  index: number;
  message: { role: "assistant"; content: string | null; refusal?: string | null };
  finish_reason: "stop" | "length" | "content_filter";
};
export type NormalizedCompletion = { choices: CompletionChoice[]; usage: TokenUsage };
export type NormalizedStreamChunk = {
  delta: { role?: "assistant"; content?: string; refusal?: string };
  finishReason?: CompletionChoice["finish_reason"];
  usage?: TokenUsage;
  complete?: boolean;
};
// Internal lifecycle metadata is never serialized into the public SSE stream.
export type ProviderStream = AsyncIterable<NormalizedStreamChunk> & { readonly signal?: AbortSignal; readonly usage?: TokenUsage };
export type ProviderContext = { requestId: string; providerModel: string; signal: AbortSignal; idempotencyKey?: string };
export type ProviderFailure = { execution: "NOT_SENT" | "REJECTED" | "UNCERTAIN"; upstreamStatus?: number; outputStarted?: boolean };

export interface AIProvider {
  chatCompletion(input: ChatCompletionInput, context: ProviderContext): Promise<NormalizedCompletion>;
  streamChatCompletion(input: ChatCompletionInput, context: ProviderContext): Promise<ProviderStream>;
  normalizeResponse(response: unknown): NormalizedCompletion;
  normalizeUsage(response: unknown): TokenUsage;
  normalizeError(status?: number, response?: unknown): GatewayError;
}

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly type: string,
    public readonly code: string,
    public readonly retryAfter?: number,
    public readonly usage?: TokenUsage,
    public readonly providerFailure?: ProviderFailure,
  ) { super(message); this.name = "GatewayError"; }
}

export function providerError(usage?: TokenUsage) {
  return new GatewayError(502, "The upstream provider is temporarily unavailable.", "server_error", "provider_unavailable", undefined, usage);
}

export function streamError(code = "streaming_interrupted", usage?: TokenUsage) {
  return new GatewayError(502, code === "usage_missing" ? "The upstream usage could not be confirmed." : "The upstream stream was interrupted.", "server_error", code, undefined, usage, { execution: "UNCERTAIN" });
}
