import "server-only";
import { z } from "zod";
import { HttpError } from "./http";

const range = z.enum(["24H", "7D", "30D"]).default("7D");
const pagination = {
  page: z.string().regex(/^\d{1,6}$/).default("1").transform(Number).refine((value) => value >= 1 && value <= 100000),
  pageSize: z.enum(["10", "25", "50"]).default("25").transform(Number),
};
export const overviewQuery = z.strictObject({ range });
export const usageQuery = z.strictObject({
  range, ...pagination,
  modelId: z.uuid().optional(), apiKeyId: z.uuid().optional(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional(),
});
export const paymentHistoryQuery = z.strictObject(pagination);
export const billingQuery = z.strictObject({ ...pagination, rechargePage: pagination.page });

export function parseAnalyticsQuery<T>(params: URLSearchParams, schema: z.ZodType<T>): T {
  if (params.toString().length > 1024) throw new HttpError(400, "Invalid filters. Clear the filters and try again.");
  const allowed = schema instanceof z.ZodObject ? new Set(Object.keys(schema.shape)) : new Set<string>();
  const input: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (!allowed.has(key)) throw new HttpError(400, "Invalid filters. Clear the filters and try again.");
    if (Object.hasOwn(input, key)) throw new HttpError(400, "Duplicate filters are not allowed.");
    input[key] = value;
  }
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, "Invalid filters. Clear the filters and try again.");
  return result.data;
}
export function pageQueryParams(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.append(key, value);
  }
  return query;
}
