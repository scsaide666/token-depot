import "server-only";
import { Buffer } from "node:buffer";
import type { Model } from "@/generated/prisma/client";
import { GatewayError, type ChatCompletionInput } from "@/lib/ai/types";
import { CHAT_LIMITS } from "@/lib/ai/types/limits";
import { calculateCosts } from "./money";

export type BillingModel = Pick<Model, "id" | "slug" | "provider" | "providerModel" | "contextWindow" | "inputPricePerMillion" | "outputPricePerMillion" | "markupMultiplier">;

export function estimateBudget(input: ChatCompletionInput, model: BillingModel) {
  // UTF-8 bytes deliberately overestimate ordinary BPE text tokenization. Include roles,
  // separators and a fixed framing allowance; actual billing never uses this estimate.
  const estimatedInputTokens = 64 + input.messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, "utf8") + Buffer.byteLength(message.role, "utf8") + 16, 0);
  const remainingContext = model.contextWindow - estimatedInputTokens;
  const configured = Number(process.env.GATEWAY_DEFAULT_MAX_OUTPUT_TOKENS ?? "1024");
  const defaultLimit = Number.isInteger(configured) && configured >= 1 && configured <= CHAT_LIMITS.outputTokens ? configured : 1024;
  const maxOutputTokens = input.max_completion_tokens ?? input.max_tokens ?? Math.min(defaultLimit, remainingContext);
  if (remainingContext < 1 || maxOutputTokens > remainingContext || (model.provider === "DEEPSEEK" && maxOutputTokens > 393216)) throw new GatewayError(400, "The requested token budget exceeds this model's limits.", "invalid_request_error", "context_length_exceeded");
  const { userCost: reservedAmount } = calculateCosts(estimatedInputTokens, maxOutputTokens, model);
  // Always transmit the budget used for the hold, including when the caller omits it.
  const boundedInput: ChatCompletionInput = input.max_tokens !== undefined ? input : { ...input, max_completion_tokens: maxOutputTokens };
  return { estimatedInputTokens, maxOutputTokens, reservedAmount, boundedInput };
}
