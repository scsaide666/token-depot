import type { PlaygroundStats } from "./playground-types";

// UI-only output budget, not a billing quote or wallet reservation. Decimal strings
// are multiplied exactly; input tokens and future price changes are excluded.
export function estimatedOutputBudget(price: string, tokens: number): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(price) || !Number.isSafeInteger(tokens) || tokens < 1) return null;
  const [whole, fraction = ""] = price.split(".");
  const amount = (BigInt(whole + fraction) * BigInt(tokens)).toString().padStart(fraction.length + 7, "0");
  const scale = fraction.length + 6;
  const result = `${amount.slice(0, -scale)}.${amount.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "");
  return `¥${result}`;
}

export function confirmedActualCost(stats: PlaygroundStats | null): string | null {
  if (!stats || stats.status !== "SUCCESS" || stats.actualCost === null ||
    [stats.inputTokens, stats.outputTokens, stats.totalTokens].some(value => value === null || !Number.isSafeInteger(value) || value < 0) ||
    stats.inputTokens! + stats.outputTokens! !== stats.totalTokens) return null;
  return `¥${stats.actualCost.includes(".") ? stats.actualCost.replace(/0+$/, "").replace(/\.$/, "") : stats.actualCost}`;
}
