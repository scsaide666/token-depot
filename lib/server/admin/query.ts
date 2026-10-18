import "server-only";
import { z } from "zod";
import { HttpError } from "../http-error";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { const d = new Date(s); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; });
const dates = { from: date.optional(), to: date.optional() };
const page = { page: z.string().regex(/^\d{1,6}$/).default("1").transform(Number).refine((n) => n >= 1 && n <= 100000), pageSize: z.enum(["10", "25", "50"]).default("25").transform(Number) };
const search = z.string().trim().max(120).optional();
const checkDates = <T extends { from?: string; to?: string }>(value: T) => {
  if (value.from && value.to && value.from > value.to) return false;
  if (value.from && value.to && new Date(value.to).getTime() - new Date(value.from).getTime() > 365 * 86400000) return false;
  return true;
};
// Refinement lives inside date values and in the parser so query keys remain strict.
export const adminOverviewQuery = z.strictObject(dates);
export const adminUsersQuery = z.strictObject({ ...page, search, status: z.enum(["ACTIVE", "SUSPENDED"]).optional() });
export const adminRequestsQuery = z.strictObject({ ...page, ...dates, userId: z.uuid().optional(), modelId: z.union([z.uuid(), z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)]).optional(), status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional() });
export const adminPaymentsQuery = z.strictObject({ ...page, ...dates, userId: z.uuid().optional(), method: z.enum(["ALIPAY", "WECHAT"]).optional(), status: z.enum(["PENDING", "PAID", "FAILED", "CLOSED", "REFUNDED"]).optional() });
export const adminModelsQuery = z.strictObject({ ...page, ...dates, search, provider: z.enum(["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"]).optional() });
export function validateAdminDates(value: { from?: string; to?: string }) {
  if (!checkDates(value)) throw new HttpError(400, "Use a valid date range of at most one year.");
}
export function adminWindow(value: { from?: string; to?: string }, now = new Date(), days = 30) {
  validateAdminDates(value);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = value.to ? new Date(new Date(value.to).getTime() + 86400000) : now;
  const start = value.from ? new Date(value.from) : new Date(value.to ? end.getTime() - days * 86400000 : today.getTime() - (days - 1) * 86400000);
  if (start >= end || end.getTime() - start.getTime() > 366 * 86400000) throw new HttpError(400, "Use a valid date range of at most one year.");
  return { start, end };
}
