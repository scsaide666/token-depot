import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "./db";
import { HttpError, requireApiSession } from "./http";
import { publicModelRecord } from "./models";
import { channelConfigured, envPrefix } from "@/lib/ai/router/channel-config";
import { chatCompletionSchema } from "@/lib/ai/types";
import { playgroundParameters } from "@/lib/playground-parameters";
import { admitRisk } from "@/lib/risk/limiter";
import { requestIpHash } from "@/lib/risk/identity";
import { gatewayPolicy } from "@/lib/risk/config";
import { money } from "@/lib/billing/money";
import type { PlaygroundModel, PlaygroundStats } from "@/lib/playground-types";

export async function playgroundModels(): Promise<PlaygroundModel[]> {
  const [records, primaries] = await Promise.all([
    getDb().model.findMany({ where: { enabled: true }, orderBy: [{ provider: "asc" }, { name: "asc" }, { slug: "asc" }], take: 200,
      include: { channels: { include: { channel: true }, take: 21 } } }),
    getDb().providerChannel.findMany({ where: { code: { in: ["openai-primary", "anthropic-primary", "google-primary", "deepseek-primary"] } }, take: 4 }),
  ]);
  return records.filter(record => record.channels.length ? record.channels.length <= 20 && record.channels.some(binding => binding.enabled && binding.channel.enabled &&
    binding.channel.provider === record.provider && binding.providerModel === record.providerModel && binding.contextWindow >= record.contextWindow && channelConfigured(binding.channel)) :
    channelConfigured({ provider: record.provider, apiKeyEnv: `${envPrefix[record.provider]}_API_KEY`, baseUrlEnv: `${envPrefix[record.provider]}_BASE_URL`, timeoutMs: 90000 }) &&
    primaries.every(channel => channel.code !== `${record.provider.toLowerCase()}-primary` || (channel.enabled && channel.provider === record.provider && channelConfigured(channel))))
    .map(record => ({ ...publicModelRecord(record), parameters: playgroundParameters(record) }));
}

const submissionSchema = z.strictObject({
  submissionId: z.uuid(), model: z.string(), messages: chatCompletionSchema.shape.messages,
  temperature: z.number().optional(), max_tokens: z.number().int(),
});
export async function playgroundInput(value: unknown) {
  const parsed = submissionSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "Check the model, messages and output token limit.");
  const { submissionId, ...input } = parsed.data;
  const chat = chatCompletionSchema.safeParse({ ...input, stream: true, stream_options: { include_usage: true } });
  if (!chat.success) throw new HttpError(400, "The conversation exceeds the request limits. Reduce its length or clear it.");
  const model = await getDb().model.findUnique({ where: { slug: input.model }, select: { enabled: true, provider: true, providerModel: true, contextWindow: true } });
  if (!model?.enabled) throw new HttpError(404, "This model is no longer available.");
  const policy = playgroundParameters(model);
  if (input.max_tokens > policy.maxOutputTokens) throw new HttpError(400, `This model allows up to ${policy.maxOutputTokens} output tokens in Playground.`);
  if (input.temperature !== undefined && (!policy.temperature || input.temperature < policy.temperature.min || input.temperature > policy.temperature.max))
    throw new HttpError(400, "This model does not support the selected temperature.");
  return { submissionId, input: chat.data };
}
export async function limitPlayground(request: Request, userId: string, kind: "submit" | "stats") {
  const policy = gatewayPolicy(), endpoint = `playground-${kind}`;
  await admitRisk({ id: `${endpoint}:${crypto.randomUUID()}`, dimensions: [
    { scope: "user", id: `${endpoint}:${userId}`, rpm: kind === "submit" ? policy.userRpm : 600, tpm: 0 },
    { scope: "ip", id: `${endpoint}:${requestIpHash(request)}`, rpm: kind === "submit" ? policy.ipRpm : 1200, tpm: 0 },
  ] });
}
export async function claimPlaygroundRun(userId: string, submissionId: string) {
  try { return { run: await getDb().playgroundRun.create({ data: { userId, submissionId } }), duplicate: false }; }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const run = await getDb().playgroundRun.findUniqueOrThrow({ where: { userId_submissionId: { userId, submissionId } } });
    return { run, duplicate: true };
  }
}
export async function playgroundStats(id: string): Promise<PlaygroundStats> {
  const { user } = await requireApiSession();
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Request not found.");
  const run = await getDb().playgroundRun.findFirst({ where: { id, userId: user.id }, select: { id: true, rejectedAt: true, errorCode: true, createdAt: true } });
  if (!run) throw new HttpError(404, "Request not found.");
  const [record, wallet] = await Promise.all([
    getDb().apiRequest.findFirst({ where: { requestId: run.id, userId: user.id, source: "PLAYGROUND" }, select: {
      status: true, modelSlug: true, model: { select: { slug: true } }, inputTokens: true, outputTokens: true, totalTokens: true, latencyMs: true, userCost: true, errorCode: true, reservationExpiresAt: true,
    } }), getDb().wallet.findUniqueOrThrow({ where: { userId: user.id }, select: { balance: true, reservedBalance: true } }),
  ]);
  if (!record && !run.rejectedAt && Date.now() - run.createdAt.getTime() > 30000) throw new HttpError(503, "Request statistics are temporarily unavailable. Check Usage before sending again.");
  const available = money(wallet.balance).minus(money(wallet.reservedBalance)).toFixed();
  const notDispatched = record?.status === "FAILED" && record.reservationExpiresAt === null;
  return { requestId: run.id, status: record?.status ?? (run.rejectedAt ? "FAILED" : "PENDING"), model: record?.modelSlug ?? record?.model?.slug ?? null,
    inputTokens: record?.inputTokens ?? null, outputTokens: record?.outputTokens ?? null, totalTokens: record?.totalTokens ?? null,
    latencyMs: record?.latencyMs ?? null, actualCost: record?.userCost?.toFixed() ?? (notDispatched || (run.rejectedAt && !record) ? "0" : null), currency: "CNY",
    errorCode: record?.errorCode ?? run.errorCode, availableBalance: available,
    balanceDisplay: `¥${money(available).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` };
}
