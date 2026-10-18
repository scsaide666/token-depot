import "server-only";
import { z } from "zod";
import { GatewayError, providerError, streamError, type ChatCompletionInput, type CompletionChoice, type ProviderContext, type NormalizedStreamChunk, type TokenUsage } from "../types";
import { JsonProvider, type ProviderConfig } from "./json-provider";
import { nativeTextInput, stopSequences } from "./text-input";
import { checkedUsage, tokenCount } from "./usage";
import type { SseEvent } from "./sse";

const usageSchema = z.object({ usage: z.object({ input_tokens: tokenCount, output_tokens: tokenCount,
  cache_creation_input_tokens: tokenCount.nullable().optional(), cache_read_input_tokens: tokenCount.nullable().optional(),
}) });
const responseSchema = z.object({ role: z.literal("assistant"), content: z.array(z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.enum(["thinking", "redacted_thinking"]) }),
])), stop_reason: z.enum(["end_turn", "stop_sequence", "max_tokens", "refusal", "model_context_window_exceeded"]) });

export class AnthropicProvider extends JsonProvider {
  constructor(config: ProviderConfig = {
    apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1", timeoutMs: process.env.ANTHROPIC_TIMEOUT_MS,
  }) { super(config, "ANTHROPIC"); }
  protected prepareRequest(input: ChatCompletionInput, context: ProviderContext) {
    if (input.temperature !== undefined && input.temperature > 1) throw new GatewayError(400, "Temperature must be between 0 and 1 for this model.", "invalid_request_error", "invalid_request");
    const { system, messages } = nativeTextInput(input), stop = stopSequences(input);
    return { path: "messages", headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, body: {
      model: context.providerModel, messages, max_tokens: input.max_completion_tokens ?? input.max_tokens ?? 1024, stream: false,
      ...(system ? { system } : {}), ...(stop !== undefined ? { stop_sequences: stop } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}), ...(input.top_p !== undefined ? { top_p: input.top_p } : {}),
    } };
  }
  protected prepareStreamRequest(input: ChatCompletionInput, context: ProviderContext) {
    const prepared = this.prepareRequest(input, context);
    return { ...prepared, body: { ...prepared.body, stream: true } };
  }
  protected async *normalizeStream(events: AsyncIterable<SseEvent>): AsyncGenerator<NormalizedStreamChunk> {
    let start: Record<string, unknown> | undefined, finishReason: CompletionChoice["finish_reason"] | undefined, usage: TokenUsage | undefined;
    const blocks = new Map<number, string>();
    try {
      for await (const event of events) {
        const value = JSON.parse(event.data) as Record<string, unknown>;
        if (!value || typeof value !== "object" || typeof value.type !== "string") throw streamError();
        if (value.type === "error") throw streamError();
        if (value.type === "ping") continue;
        if (value.type === "message_start") {
          if (start) throw streamError();
          const parsed = usageSchema.safeParse(value.message); if (!parsed.success) throw streamError();
          start = parsed.data.usage; yield { delta: { role: "assistant" } }; continue;
        }
        if (!start) throw streamError();
        if (value.type === "content_block_start") {
          const block = value.content_block as Record<string, unknown>;
          if (finishReason || !Number.isInteger(value.index) || Number(value.index) < 0 || blocks.has(Number(value.index)) || !block || !["text", "thinking", "redacted_thinking"].includes(String(block.type))) throw streamError();
          blocks.set(Number(value.index), String(block.type));
          if (block.type === "text" && typeof block.text === "string" && block.text) yield { delta: { content: block.text } };
        } else if (value.type === "content_block_delta") {
          const delta = value.delta as Record<string, unknown>, type = blocks.get(Number(value.index));
          if (finishReason || !type || !delta) throw streamError();
          if (delta.type === "text_delta") {
            if (type !== "text" || typeof delta.text !== "string") throw streamError();
            yield { delta: { content: delta.text } };
          } else if (!["thinking_delta", "signature_delta"].includes(String(delta.type))) throw streamError();
        } else if (value.type === "content_block_stop") {
          if (!blocks.delete(Number(value.index))) throw streamError();
        } else if (value.type === "message_delta") {
          const delta = value.delta as Record<string, unknown>, u = value.usage as Record<string, unknown>;
          if (!delta || !u || finishReason || blocks.size) throw streamError();
          const combined = { ...start, ...u };
          // Nonterminal snapshots are cumulative, but not authoritative final usage.
          if (delta.stop_reason == null) { this.normalizeUsage({ usage: combined }); start = combined; continue; }
          if (!["end_turn", "stop_sequence", "max_tokens", "refusal", "model_context_window_exceeded"].includes(String(delta.stop_reason))) throw streamError();
          if (!tokenCount.safeParse(u.output_tokens).success) throw streamError("usage_missing");
          usage = this.normalizeUsage({ usage: combined });
          finishReason = delta.stop_reason === "refusal" ? "content_filter" : ["max_tokens", "model_context_window_exceeded"].includes(String(delta.stop_reason)) ? "length" : "stop";
          yield { delta: {}, usage };
        } else if (value.type === "message_stop") {
          if (!finishReason || !usage || blocks.size) throw streamError("usage_missing");
          yield { delta: {}, finishReason, usage, complete: true }; return;
        }
        // Unknown extension events are skipped, never reflected into public output.
      }
      throw streamError();
    } catch (error) { if (usage) throw streamError("streaming_interrupted", usage); throw error; }
  }
  normalizeUsage(response: unknown) {
    const parsed = usageSchema.safeParse(response);
    if (!parsed.success) throw providerError();
    const u = parsed.data.usage;
    // Anthropic input_tokens excludes cache reads and writes; output includes thinking.
    return checkedUsage(u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), u.output_tokens);
  }
  normalizeResponse(response: unknown) {
    const usage = this.normalizeUsage(response), parsed = responseSchema.safeParse(response);
    if (!parsed.success) throw providerError(usage);
    const value = parsed.data, content = this.redact(value.content.flatMap((block) => block.type === "text" ? [block.text] : []).join(""));
    const finishReason: CompletionChoice["finish_reason"] = value.stop_reason === "refusal" ? "content_filter" : ["max_tokens", "model_context_window_exceeded"].includes(value.stop_reason) ? "length" : "stop";
    return { usage, choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: finishReason }] };
  }
}
