import "server-only";
import { z } from "zod";
import { providerError, streamError, type ChatCompletionInput, type ProviderContext, type NormalizedStreamChunk, type CompletionChoice, type TokenUsage } from "../types";
import { JsonProvider, type ProviderConfig, type ProviderRequest } from "./json-provider";
import { checkedUsage, tokenCount } from "./usage";
import type { SseEvent } from "./sse";

const usageSchema = z.object({ usage: z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount, total_tokens: tokenCount }) });
const choiceSchema = z.object({ choices: z.array(z.object({
  index: z.literal(0), message: z.object({ role: z.literal("assistant"), content: z.string().nullable(), refusal: z.string().nullable().optional() }),
  finish_reason: z.enum(["stop", "length", "content_filter"]),
})).length(1) });
const streamSchema = z.object({ choices: z.array(z.object({ index: z.literal(0), delta: z.object({
  role: z.literal("assistant").nullable().optional(), content: z.string().nullable().optional(), refusal: z.string().nullable().optional(),
}), finish_reason: z.enum(["stop", "length", "content_filter"]).nullable() })).max(1), usage: z.unknown().optional() });

export class OpenAIProvider extends JsonProvider {
  constructor(config: ProviderConfig = {
    apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", timeoutMs: process.env.OPENAI_TIMEOUT_MS,
  }, provider: "OPENAI" | "DEEPSEEK" = "OPENAI") { super(config, provider); }

  protected prepareRequest(input: ChatCompletionInput, context: ProviderContext): ProviderRequest {
    return { path: "chat/completions", headers: { Authorization: `Bearer ${this.apiKey}` }, body: {
      model: context.providerModel, messages: input.messages, stream: false, store: false,
      ...((input.max_completion_tokens ?? input.max_tokens) !== undefined ? { max_completion_tokens: input.max_completion_tokens ?? input.max_tokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}), ...(input.top_p !== undefined ? { top_p: input.top_p } : {}),
      ...(input.stop !== undefined ? { stop: input.stop } : {}),
    } };
  }
  normalizeUsage(response: unknown) {
    const parsed = usageSchema.safeParse(response);
    if (!parsed.success) throw providerError();
    const usage = parsed.data.usage;
    // Cached input and reasoning output are already included in these totals.
    return checkedUsage(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens);
  }
  protected allowsUsageOnFinishChoice() { return false; }
  protected async *normalizeStream(events: AsyncIterable<SseEvent>): AsyncGenerator<NormalizedStreamChunk> {
    let finishReason: CompletionChoice["finish_reason"] | undefined, usage: TokenUsage | undefined;
    try {
      for await (const event of events) {
        if (event.data === "[DONE]") {
          if (!finishReason) throw streamError();
          if (!usage) throw streamError("usage_missing");
          yield { delta: {}, finishReason, usage, complete: true }; return;
        }
        const value: unknown = JSON.parse(event.data);
        if (value && typeof value === "object" && "error" in value) throw streamError();
        const parsed = streamSchema.safeParse(value);
        if (!parsed.success) throw streamError();
        const choice = parsed.data.choices[0];
        // OpenAI uses a usage-only terminal chunk. DeepSeek also sends confirmed
        // usage on its terminal finish choice; only its adapter opts into this.
        // Nonterminal snapshots can never authorize a final customer charge.
        if (parsed.data.usage != null) {
          const terminalChoice = this.allowsUsageOnFinishChoice() && !finishReason && !!choice?.finish_reason;
          if (!(finishReason && !parsed.data.choices.length) && !terminalChoice) throw streamError("usage_missing");
          const next = this.normalizeUsage(value);
          if (usage && (usage.inputTokens !== next.inputTokens || usage.outputTokens !== next.outputTokens)) throw streamError();
          usage = next;
          yield { delta: {}, usage };
        }
        if (!choice) continue;
        if (finishReason) throw streamError();
        const { role, content, refusal } = choice.delta;
        if (role || content || refusal) yield { delta: { ...(role ? { role } : {}), ...(content ? { content } : {}), ...(refusal ? { refusal } : {}) } };
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      throw streamError();
    } catch (error) {
      const safe = error instanceof Error && "code" in error ? error : streamError();
      if (usage && safe instanceof Error && "status" in safe) throw streamError("streaming_interrupted", usage);
      throw safe;
    }
  }
  normalizeResponse(response: unknown) {
    const usage = this.normalizeUsage(response), parsed = choiceSchema.safeParse(response);
    if (!parsed.success) throw providerError(usage);
    return { usage, choices: parsed.data.choices.map((choice) => ({ index: choice.index, finish_reason: choice.finish_reason,
      message: { role: choice.message.role, content: this.redact(choice.message.content), ...(choice.message.refusal !== undefined ? { refusal: this.redact(choice.message.refusal) } : {}) },
    })) };
  }
}
