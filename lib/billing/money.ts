import { Prisma } from "@/generated/prisma/client";

// 20 fractional places preserve one token at the minimum supported cost and markup.
// Keep this constructor isolated from Prisma's default Decimal precision.
export const Money = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
export type DecimalValue = Prisma.Decimal | string;
export type Prices = { inputPricePerMillion: DecimalValue; outputPricePerMillion: DecimalValue; markupMultiplier: DecimalValue };
export function money(value: DecimalValue) {
  const result = new Money(value.toString());
  if (!result.isFinite()) throw new Error("Invalid monetary value.");
  return result;
}

export function calculateCosts(inputTokens: number, outputTokens: number, prices: Prices) {
  for (const tokens of [inputTokens, outputTokens]) if (!Number.isInteger(tokens) || tokens < 0 || tokens > 2147483647) throw new Error("Invalid token count.");
  const inputCost = money(prices.inputPricePerMillion).times(inputTokens).div("1000000");
  const outputCost = money(prices.outputPricePerMillion).times(outputTokens).div("1000000");
  const markup = money(prices.markupMultiplier);
  if (inputCost.isNegative() || outputCost.isNegative() || !markup.gt(0)) throw new Error("Invalid billing prices.");
  const providerCost = inputCost.plus(outputCost);
  const userCost = providerCost.times(markup);
  return { providerCost: providerCost.toFixed(20), userCost: userCost.toFixed(20) };
}
