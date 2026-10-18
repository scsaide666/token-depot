import "server-only";
import { z } from "zod";
import { providerError, type TokenUsage } from "../types";

export const tokenCount = z.number().int().min(0).max(2147483647);
export function checkedUsage(inputTokens: number, outputTokens: number, totalTokens = inputTokens + outputTokens): TokenUsage {
  if (![inputTokens, outputTokens, totalTokens].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) || inputTokens + outputTokens !== totalTokens) throw providerError();
  return { inputTokens, outputTokens, totalTokens };
}
