import "server-only";
import { Prisma, type ProviderChannel } from "@/generated/prisma/client";
import { channelConfigured, validEnvReference } from "@/lib/ai/router/channel-config";
import { channelHealth, channelStatistics } from "@/lib/ai/router/health";
import type { BindingInput, ChannelInput } from "@/lib/provider-schemas";
import type { BindingRecord, ChannelRecord, ProviderPageData, AttemptRecord } from "@/lib/provider-types";
import type { PageInfo } from "@/lib/analytics-types";
import { getDb } from "../db";
import { HttpError, requireAdminApiSession } from "../http";

const pagination = (query: { page: number; pageSize: number }, total: number): PageInfo => {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return { ...query, page: Math.min(query.page, totalPages), total, totalPages };
};
function refs(channel: Pick<ProviderChannel, "provider" | "apiKeyEnv" | "baseUrlEnv">) {
  if (!validEnvReference(channel.provider, channel.apiKeyEnv, "API_KEY") || !validEnvReference(channel.provider, channel.baseUrlEnv, "BASE_URL"))
    throw new HttpError(422, "Use server environment references belonging to this provider, ending in API_KEY and BASE_URL.");
}
function writeFailure(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new HttpError(409, "This channel code or preferred model route already exists.");
    if (error.code === "P2025") throw new HttpError(404, "Channel not found.");
  }
  throw error;
}
export async function getAdminProviders(query: ProviderPageData["query"]): Promise<ProviderPageData> {
  await requireAdminApiSession();
  const where: Prisma.ProviderChannelWhereInput = { ...(query.provider ? { provider: query.provider } : {}),
    ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { code: { contains: query.search, mode: "insensitive" } }] } : {}) };
  const { records, page } = await getDb().$transaction(async tx => {
    const page = pagination(query, await tx.providerChannel.count({ where }));
    return { page, records: await tx.providerChannel.findMany({ where, orderBy: [{ priority: "asc" }, { id: "asc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }) };
  }, { isolationLevel: "RepeatableRead" });
  const stats = await channelStatistics(records.map(r => r.id));
  const channels: ChannelRecord[] = records.map(r => {
    const configured = channelConfigured(r), windows = stats.get(r.id)!;
    return { id: r.id, code: r.code, name: r.name, provider: r.provider, enabled: r.enabled, priority: r.priority, weight: r.weight,
      apiKeyEnv: r.apiKeyEnv, baseUrlEnv: r.baseUrlEnv, timeoutMs: r.timeoutMs, rpm: r.rpm, tpm: r.tpm, concurrency: r.concurrency,
      failureThreshold: r.failureThreshold, cooldownMs: r.cooldownMs, idempotentRequests: r.idempotentRequests, configured,
      circuitState: r.circuitState, openedUntil: r.openedUntil?.toISOString() ?? null, rateLimitedUntil: r.rateLimitedUntil?.toISOString() ?? null,
      health: channelHealth(r, configured, windows[query.window]), windows };
  });
  return { channels, pagination: page, query: { ...query, page: page.page } };
}
export async function createChannel(input: ChannelInput) {
  await requireAdminApiSession(); refs(input);
  try { return { id: (await getDb().providerChannel.create({ data: input, select: { id: true } })).id }; }
  catch (error) { return writeFailure(error); }
}
export async function updateChannel(id: string, input: Partial<Omit<ChannelInput, "provider" | "code">>) {
  await requireAdminApiSession();
  try {
    return await getDb().$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ProviderChannel" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.providerChannel.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Channel not found.");
      refs({ ...current, ...input });
      return tx.providerChannel.update({ where: { id }, data: input, select: { id: true } });
    });
  } catch (error) { return writeFailure(error); }
}
export async function getChannelBindings(id: string, query: { page: number; pageSize: number }) {
  await requireAdminApiSession();
  const channel = await getDb().providerChannel.findUnique({ where: { id }, select: { provider: true } });
  if (!channel) throw new HttpError(404, "Channel not found.");
  return getDb().$transaction(async tx => {
    const page = pagination(query, await tx.modelChannel.count({ where: { channelId: id } }));
    const rows = await tx.modelChannel.findMany({ where: { channelId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize,
      include: { model: { select: { slug: true, provider: true, providerModel: true, contextWindow: true } } } });
    const bindings: BindingRecord[] = rows.map(r => ({ id: r.id, modelId: r.modelId, modelSlug: r.model.slug, providerModel: r.providerModel,
      compatible: r.model.provider === channel.provider && r.model.providerModel === r.providerModel && r.contextWindow >= r.model.contextWindow,
      contextWindow: r.contextWindow, inputPricePerMillion: r.inputPricePerMillion.toFixed(), outputPricePerMillion: r.outputPricePerMillion.toFixed(), enabled: r.enabled, preferred: r.preferred }));
    return { bindings, pagination: page };
  }, { isolationLevel: "RepeatableRead" });
}
export async function saveBinding(channelId: string, input: BindingInput) {
  await requireAdminApiSession();
  try {
    return await getDb().$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Model" WHERE slug = ${input.modelSlug} FOR UPDATE`;
      const model = await tx.model.findUnique({ where: { slug: input.modelSlug } });
      const channel = await tx.providerChannel.findUnique({ where: { id: channelId } });
      if (!model || !channel) throw new HttpError(404, "Model or channel not found.");
      if (model.provider !== channel.provider || model.providerModel !== input.providerModel || input.contextWindow < model.contextWindow)
        throw new HttpError(422, "This channel must use the model's exact provider model ID and support its full context window.");
      const where = { modelId_channelId: { modelId: model.id, channelId } }, existing = await tx.modelChannel.findUnique({ where, select: { id: true } });
      if (!existing && await tx.modelChannel.count({ where: { modelId: model.id } }) >= 20) throw new HttpError(422, "A model supports at most 20 channels.");
      if (input.preferred && (!input.enabled || !channel.enabled)) throw new HttpError(422, "Enable this binding and channel before selecting it as preferred.");
      if (input.preferred) await tx.modelChannel.updateMany({ where: { modelId: model.id, preferred: true }, data: { preferred: false } });
      const data = { providerModel: input.providerModel, contextWindow: input.contextWindow, inputPricePerMillion: input.inputPricePerMillion,
        outputPricePerMillion: input.outputPricePerMillion, enabled: input.enabled, preferred: input.preferred };
      return tx.modelChannel.upsert({ where, create: { ...data, modelId: model.id, channelId }, update: data, select: { id: true } });
    }, { maxWait: 15000, timeout: 15000 });
  } catch (error) { return writeFailure(error); }
}
export async function getChannelAttempts(id: string, query: { page: number; pageSize: number }) {
  await requireAdminApiSession();
  if (!await getDb().providerChannel.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(404, "Channel not found.");
  return getDb().$transaction(async tx => {
    const page = pagination(query, await tx.providerAttempt.count({ where: { channelId: id } }));
    const rows = await tx.providerAttempt.findMany({ where: { channelId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize,
      select: { id: true, requestId: true, attemptNumber: true, status: true, executionState: true, costStatus: true, providerCost: true, latencyMs: true, errorCode: true, createdAt: true } });
    const attempts: AttemptRecord[] = rows.map(r => ({ ...r, providerCost: r.providerCost?.toFixed(20) ?? null, createdAt: r.createdAt.toISOString() }));
    return { attempts, pagination: page };
  }, { isolationLevel: "RepeatableRead" });
}
