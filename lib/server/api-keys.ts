import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ApiKeyRecord } from "@/lib/api-key-types";
import { getDb } from "./db";
import { HttpError } from "./http";
import { generateApiKey } from "./api-key-crypto";

const metadataSelect = {
  id: true, name: true, keyPrefix: true, lastUsedAt: true, expiresAt: true,
  revokedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ApiKeySelect;
type MetadataRecord = Prisma.ApiKeyGetPayload<{ select: typeof metadataSelect }>;

function metadata(record: MetadataRecord): ApiKeyRecord {
  return {
    id: record.id, name: record.name, keyPrefix: record.keyPrefix,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
    status: record.revokedAt ? "revoked" : record.expiresAt && record.expiresAt <= new Date() ? "expired" : "active",
  };
}

const notFound = () => new HttpError(404, "This API key is no longer available. Refresh the page and try again.");

export async function listApiKeys(userId: string) {
  const records = await getDb().apiKey.findMany({ where: { userId }, select: metadataSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return records.map(metadata);
}

export async function createApiKey(userId: string, name: string) {
  const generated = generateApiKey();
  const record = await getDb().apiKey.create({
    data: { userId, name, keyPrefix: generated.keyPrefix, keyHash: generated.keyHash },
    select: metadataSelect,
  });
  // The secret is returned only by this creation flow, after a successful write.
  return { apiKey: metadata(record), key: generated.key };
}

export async function renameApiKey(userId: string, id: string, name: string) {
  try {
    const record = await getDb().apiKey.update({ where: { id, userId }, data: { name }, select: metadataSelect });
    return metadata(record);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw notFound();
    throw error;
  }
}

export async function revokeApiKey(userId: string, id: string) {
  // Atomic owner and state checks preserve the original revocation timestamp.
  const records = await getDb().apiKey.updateManyAndReturn({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() }, select: metadataSelect });
  const record = records[0] ?? await getDb().apiKey.findFirst({ where: { id, userId }, select: metadataSelect });
  if (!record) throw notFound();
  return metadata(record);
}

export async function deleteApiKey(userId: string, id: string) {
  const result = await getDb().apiKey.deleteMany({ where: { id, userId } });
  if (!result.count) throw notFound();
}
