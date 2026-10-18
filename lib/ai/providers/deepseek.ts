import "server-only";
import { OpenAIProvider } from "./openai";
import type { ProviderConfig } from "./json-provider";
import type { ChatCompletionInput, ProviderContext } from "../types";

export class DeepSeekProvider extends OpenAIProvider {
  constructor(config: ProviderConfig = {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    timeoutMs: process.env.DEEPSEEK_TIMEOUT_MS,
  }) { super(config, "DEEPSEEK"); }

  // Verified native DeepSeek streams place final usage on the finish choice,
  // even with include_usage enabled. Ordinary content snapshots remain invalid.
  protected override allowsUsageOnFinishChoice() { return true; }

  protected prepareRequest(input: ChatCompletionInput, context: ProviderContext) {
    const maxTokens = input.max_completion_tokens ?? input.max_tokens;
    return { path: "chat/completions", headers: { Authorization: `Bearer ${this.apiKey}` }, body: {
      model: context.providerModel,
      messages: input.messages.map((message) => ({ ...message, role: message.role === "developer" ? "system" : message.role })),
      stream: false,
      // Preserve the existing plain text / non-thinking contract.
      thinking: { type: "disabled" },
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.top_p !== undefined ? { top_p: input.top_p } : {}),
      ...(input.stop !== undefined ? { stop: input.stop } : {}),
    } };
  }
}
