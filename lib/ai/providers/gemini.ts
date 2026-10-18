import "server-only";
import { z } from "zod";
import { providerError, streamError, type ChatCompletionInput, type CompletionChoice, type ProviderContext, type NormalizedStreamChunk, type TokenUsage } from "../types";
import { JsonProvider, type ProviderConfig } from "./json-provider";
import { nativeTextInput, stopSequences } from "./text-input";
import { checkedUsage, tokenCount } from "./usage";
import type { SseEvent } from "./sse";

const usageSchema = z.object({ usageMetadata: z.object({ promptTokenCount: tokenCount, candidatesTokenCount: tokenCount.optional(), thoughtsTokenCount: tokenCount.optional(), totalTokenCount: tokenCount }) });
const filters = ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"] as const;
const responseSchema = z.object({ candidates: z.array(z.object({ index: z.literal(0).optional(), finishReason: z.enum(["STOP", "MAX_TOKENS", ...filters]),
  content: z.object({ role: z.literal("model").optional(), parts: z.array(z.object({ text: z.string(), thought: z.boolean().optional() })) }).optional(),
})).max(1).optional(), promptFeedback: z.object({ blockReason: z.enum(["SAFETY", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "IMAGE_SAFETY"]).optional() }).optional() });

export class GeminiProvider extends JsonProvider {
  constructor(config: ProviderConfig = {
    apiKey: process.env.GEMINI_API_KEY, baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta", timeoutMs: process.env.GEMINI_TIMEOUT_MS,
  }) { super(config, "GOOGLE"); }
  protected prepareRequest(input: ChatCompletionInput, context: ProviderContext) {
    const { system, messages } = nativeTextInput(input), stop = stopSequences(input);
    const model = context.providerModel.replace(/^models\//, "");
    return { path: `models/${encodeURIComponent(model)}:generateContent`, headers: { "x-goog-api-key": this.apiKey }, body: {
      contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { candidateCount: 1, maxOutputTokens: input.max_completion_tokens ?? input.max_tokens ?? 1024,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}), ...(input.top_p !== undefined ? { topP: input.top_p } : {}),
        ...(stop !== undefined ? { stopSequences: stop } : {}),
      },
    } };
  }
  protected prepareStreamRequest(input: ChatCompletionInput, context: ProviderContext) {
    const prepared = this.prepareRequest(input, context);
    return { ...prepared, path: prepared.path.replace(/:generateContent$/, ":streamGenerateContent"), query: { alt: "sse" } };
  }
  protected async *normalizeStream(events: AsyncIterable<SseEvent>): AsyncGenerator<NormalizedStreamChunk> {
    let finishReason: CompletionChoice["finish_reason"] | undefined, usage: TokenUsage | undefined, started = false;
    try {
      for await (const event of events) {
        const value = JSON.parse(event.data) as Record<string, unknown>;
        if (!value || typeof value !== "object" || value.error) throw streamError();
        const parsed = z.object({ candidates: z.array(z.object({ index: z.literal(0).optional(),
          finishReason: z.enum(["STOP", "MAX_TOKENS", ...filters]).optional(),
          content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional(),
        })).max(1).optional(), promptFeedback: responseSchema.shape.promptFeedback }).safeParse(value);
        if (!parsed.success) throw streamError();
        if (finishReason) {
          if (parsed.data.candidates?.length || parsed.data.promptFeedback?.blockReason || !value.usageMetadata) throw streamError();
          const final = this.normalizeUsage(value);
          if (usage && (usage.inputTokens !== final.inputTokens || usage.outputTokens !== final.outputTokens)) throw streamError();
          usage = final; yield { delta: {}, usage }; continue;
        }
        const candidate = parsed.data.candidates?.[0];
        const content = candidate?.content?.parts.filter(p => !p.thought).map(p => p.text ?? "").join("");
        if (candidate?.finishReason || parsed.data.promptFeedback?.blockReason) {
          finishReason = parsed.data.promptFeedback?.blockReason || filters.some(r => candidate?.finishReason === r) ? "content_filter" : candidate?.finishReason === "MAX_TOKENS" ? "length" : "stop";
          try { usage = this.normalizeUsage(value); } catch { /* A final frame without usage cannot be charged. */ }
        }
        if (!started) { started = true; yield { delta: { role: "assistant" }, ...(usage ? { usage } : {}) }; }
        if (content || usage) yield { delta: content ? { content } : {}, ...(usage ? { usage } : {}) };
      }
      if (!finishReason) throw streamError();
      if (!usage) throw streamError("usage_missing");
      yield { delta: {}, finishReason, usage, complete: true };
    } catch (error) { if (usage) throw streamError("streaming_interrupted", usage); throw error; }
  }
  normalizeUsage(response: unknown) {
    const parsed = usageSchema.safeParse(response);
    if (!parsed.success) throw providerError();
    const u = parsed.data.usageMetadata;
    // promptTokenCount includes cached input; output must also include thinking.
    // A missing candidate count is only valid when authoritative totals reconcile.
    return checkedUsage(u.promptTokenCount, (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), u.totalTokenCount);
  }
  normalizeResponse(response: unknown) {
    const usage = this.normalizeUsage(response), parsed = responseSchema.safeParse(response);
    if (!parsed.success) throw providerError(usage);
    const candidate = parsed.data.candidates?.[0];
    if (!candidate) {
      if (!parsed.data.promptFeedback?.blockReason) throw providerError(usage);
      return { usage, choices: [{ index: 0, message: { role: "assistant" as const, content: null, refusal: "The model declined this request." }, finish_reason: "content_filter" as const }] };
    }
    const filtered = filters.some((reason) => candidate.finishReason === reason);
    if (!candidate.content && !filtered) throw providerError(usage);
    const content = candidate.content ? this.redact(candidate.content.parts.filter((part) => !part.thought).map((part) => part.text).join("")) : null;
    const finishReason: CompletionChoice["finish_reason"] = filtered ? "content_filter" : candidate.finishReason === "MAX_TOKENS" ? "length" : "stop";
    return { usage, choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: finishReason }] };
  }
}
