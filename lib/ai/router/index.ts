import "server-only";
import type { ModelProvider } from "@/generated/prisma/client";
import { OpenAIProvider } from "../providers/openai";
import { AnthropicProvider } from "../providers/anthropic";
import { GeminiProvider } from "../providers/gemini";
import { DeepSeekProvider } from "../providers/deepseek";
import { GatewayError, type AIProvider } from "../types";
import type { ProviderConfig } from "../providers/json-provider";

export function getProvider(provider: ModelProvider, config?: ProviderConfig): AIProvider {
  if (provider === "OPENAI") return new OpenAIProvider(config);
  if (provider === "ANTHROPIC") return new AnthropicProvider(config);
  if (provider === "GOOGLE") return new GeminiProvider(config);
  if (provider === "DEEPSEEK") return new DeepSeekProvider(config);
  throw new GatewayError(500, "This model's provider is not configured.", "server_error", "provider_not_configured");
}
