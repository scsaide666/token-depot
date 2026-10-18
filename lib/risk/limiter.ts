import "server-only";
import { randomUUID } from "node:crypto";
import { riskNamespace } from "./config";
import { evalRisk, RiskUnavailable } from "./redis";
import { admitScript, finishScript } from "./scripts";

export type LimitDimension = { scope: "user" | "key" | "ip" | "endpoint"; id: string; rpm: number; tpm: number };
export type RiskPermit = { id: string; keys: string[]; dimensions: number; budget: number; window: number };
export class RiskLimited extends Error {
  constructor(public reason: "rpm" | "tpm" | "concurrency", public scope: string, public retryAfter: number) { super("Too many requests. Please retry later."); }
}
export async function admitRisk(options: { dimensions: LimitDimension[]; tokens?: number; concurrencyKey?: string; concurrency?: number; id?: string; windowMs?: number; leaseMs?: number }): Promise<RiskPermit> {
  const prefix = riskNamespace(), id = options.id ?? randomUUID(), budget = options.tokens ?? 0, window = options.windowMs ?? 60000, lease = options.leaseMs ?? 300000;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 2147483647 || !options.dimensions.length || options.dimensions.length > 4 || !/^[a-zA-Z0-9:_-]{1,100}$/.test(id)
    || !Number.isSafeInteger(window) || window < 10 || window > 60000 || !Number.isSafeInteger(lease) || lease < 10 || lease > 300000
    || !Number.isSafeInteger(options.concurrency ?? 0) || (options.concurrency ?? 0) < 0 || (options.concurrency ?? 0) > 1000
    || (options.concurrencyKey && !/^[a-zA-Z0-9_-]{1,100}$/.test(options.concurrencyKey))) throw new RiskUnavailable();
  const keys: string[] = [], args = [id, String(budget), String(window), String(lease), String(options.dimensions.length), String(options.concurrency ?? 0)];
  for (const dimension of options.dimensions) {
    if (!/^[a-zA-Z0-9_:/.-]{1,128}$/.test(dimension.id) || ![dimension.rpm, dimension.tpm].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) throw new RiskUnavailable();
    const base = `${prefix}:${dimension.scope}:${dimension.id}`;
    keys.push(base + ":rpm", base + ":tokens", base + ":amounts", base + ":total"); args.push(String(dimension.rpm), String(dimension.tpm));
  }
  keys.push(`${prefix}:concurrency:${options.concurrencyKey ?? "unused"}`, `${prefix}:permit:${id}`);
  const result = await evalRisk(admitScript, keys, args);
  if (!Array.isArray(result) || result.length !== 4 || !result.every((item) => Number.isSafeInteger(item))) throw new RiskUnavailable();
  if (result[0] !== 1) throw new RiskLimited(result[2] === 3 ? "concurrency" : result[2] === 2 ? "tpm" : "rpm", options.dimensions[result[1] - 1]?.scope ?? "key", Math.max(1, Math.ceil(result[3] / 1000)));
  return { id, keys, dimensions: options.dimensions.length, budget, window };
}
export async function finishRisk(permit: RiskPermit, actualTokens: number) {
  if (!Number.isSafeInteger(actualTokens) || actualTokens < 0 || actualTokens > 2147483647) throw new RiskUnavailable();
  await evalRisk(finishScript, permit.keys, [permit.id, String(actualTokens), String(permit.window), String(permit.dimensions)]);
}
