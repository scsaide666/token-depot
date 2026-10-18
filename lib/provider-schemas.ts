import { z } from "zod";

const provider = z.enum(["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK"]);
const reference = z.string().max(100).regex(/^[A-Z][A-Z0-9_]*$/);
const price = z.string().trim().regex(/^(0|[1-9]\d{0,13})(\.\d{1,8})?$/);
export const channelBody = z.strictObject({
  code: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().trim().min(1).max(120), provider,
  apiKeyEnv: reference, baseUrlEnv: reference, enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100), weight: z.number().int().min(1).max(1000).default(1),
  timeoutMs: z.number().int().min(100).max(120000).default(90000),
  rpm: z.number().int().min(1).max(1000000).default(60), tpm: z.number().int().min(1).max(1000000000).default(200000),
  concurrency: z.number().int().min(1).max(1000).default(10), failureThreshold: z.number().int().min(1).max(1000).default(5),
  cooldownMs: z.number().int().min(100).max(300000).default(30000), idempotentRequests: z.boolean().default(false),
});
// Defaults belong to creation only. Zod defaults inside a partial schema would
// silently reset unrelated limits whenever an administrator changes one field.
export const channelPatch = z.strictObject({
  name: channelBody.shape.name, apiKeyEnv: channelBody.shape.apiKeyEnv, baseUrlEnv: channelBody.shape.baseUrlEnv,
  enabled: channelBody.shape.enabled.removeDefault(), priority: channelBody.shape.priority.removeDefault(),
  weight: channelBody.shape.weight.removeDefault(), timeoutMs: channelBody.shape.timeoutMs.removeDefault(),
  rpm: channelBody.shape.rpm.removeDefault(), tpm: channelBody.shape.tpm.removeDefault(), concurrency: channelBody.shape.concurrency.removeDefault(),
  failureThreshold: channelBody.shape.failureThreshold.removeDefault(), cooldownMs: channelBody.shape.cooldownMs.removeDefault(),
  idempotentRequests: channelBody.shape.idempotentRequests.removeDefault(),
}).partial().refine(v => Object.keys(v).length > 0);
export const bindingBody = z.strictObject({
  modelSlug: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/),
  providerModel: z.string().trim().min(1).max(200), contextWindow: z.number().int().min(1).max(2147483647),
  inputPricePerMillion: price, outputPricePerMillion: price, enabled: z.boolean(), preferred: z.boolean(),
});
const pages = { page: z.string().regex(/^\d{1,6}$/).default("1").transform(Number).refine(n => n >= 1 && n <= 100000),
  pageSize: z.enum(["10", "25", "50"]).default("25").transform(Number) };
export const providersQuery = z.strictObject({ ...pages, window: z.enum(["5m", "1h", "24h"]).default("5m"), search: z.string().trim().max(120).optional(), provider: provider.optional() });
export const providerChildrenQuery = z.strictObject(pages);
export type ChannelInput = z.infer<typeof channelBody>;
export type BindingInput = z.infer<typeof bindingBody>;
