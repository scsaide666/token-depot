import "server-only";
import { connection } from "next/server";
import { Prisma, type Model } from "@/generated/prisma/client";
import { providerNames, type PublicModel, type AdminModelRecord } from "@/lib/model-types";
import type { ModelInput } from "@/lib/model-schemas";
import { getDb } from "./db";
import { HttpError, requireAdminApiSession } from "./http";
import { modelRevision } from "./model-cache";
import { metadataCache } from "./metadata-cache";

// 20-digit costs multiplied by 12-digit markup need up to 32 significant digits.
// Use a separate constructor so wallet arithmetic retains its existing settings.
const Money = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
const decimal = (value: Prisma.Decimal | string) => new Money(value.toString());

export function publicModelRecord(record: Model): PublicModel {
  return {
    slug: record.slug, name: record.name, provider: providerNames[record.provider],
    description: record.description, contextWindow: record.contextWindow,
    inputPricePerMillion: decimal(record.inputPricePerMillion).times(decimal(record.markupMultiplier)).toFixed(),
    outputPricePerMillion: decimal(record.outputPricePerMillion).times(decimal(record.markupMultiplier)).toFixed(),
  };
}
export function adminRecord(record: Model): AdminModelRecord {
  const publicRecord = publicModelRecord(record);
  const markup = decimal(record.markupMultiplier);
  return {
    ...publicRecord, id: record.id, providerCode: record.provider, providerModel: record.providerModel,
    enabled: record.enabled, inputCostPerMillion: record.inputPricePerMillion.toFixed(),
    outputCostPerMillion: record.outputPricePerMillion.toFixed(), markupMultiplier: markup.toFixed(),
    inputMarginPerMillion: decimal(publicRecord.inputPricePerMillion).minus(decimal(record.inputPricePerMillion)).toFixed(),
    outputMarginPerMillion: decimal(publicRecord.outputPricePerMillion).minus(decimal(record.outputPricePerMillion)).toFixed(),
    marginPercent: record.inputPricePerMillion.isZero() && record.outputPricePerMillion.isZero() ? null :
      markup.minus(1).div(markup).times(100).toDecimalPlaces(4).toFixed(),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listPublicModels() {
  await connection();
  const revision = await modelRevision();
  return metadataCache(`catalog:v1:${revision}`, 60000, async () => {
    const records = await getDb().model.findMany({ where: { enabled: true }, orderBy: [{ provider: "asc" }, { name: "asc" }, { slug: "asc" }] });
    return records.map(publicModelRecord);
  });
}
export async function publicCatalog() {
  // Next.js request-time rendering signals must propagate, rather than becoming a load error.
  await connection();
  try { return { catalog: await listPublicModels(), loadError: false }; }
  catch { console.error("Model catalog could not be loaded."); return { catalog: [] as PublicModel[], loadError: true }; }
}
export function startingPrices(catalog: PublicModel[]) {
  const minimum = (field: "inputPricePerMillion" | "outputPricePerMillion") => catalog.length ?
    catalog.map((model) => decimal(model[field])).reduce((a, b) => a.lte(b) ? a : b).toFixed() : null;
  return { input: minimum("inputPricePerMillion"), output: minimum("outputPricePerMillion") };
}
export async function listAdminModels() {
  await requireAdminApiSession();
  return (await getDb().model.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 })).map(adminRecord);
}
function modelWriteFailure(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new HttpError(409, "This model slug already exists. Choose another model ID.");
    if (error.code === "P2025") throw new HttpError(404, "This model no longer exists. Refresh and try again.");
  }
  throw error;
}
export async function createModel(data: ModelInput) {
  await requireAdminApiSession();
  try { return adminRecord(await getDb().model.create({ data })); }
  catch (error) { return modelWriteFailure(error); }
}
export async function updateModel(id: string, data: Partial<ModelInput>) {
  await requireAdminApiSession();
  try { return adminRecord(await getDb().model.update({ where: { id }, data })); }
  catch (error) { return modelWriteFailure(error); }
}
