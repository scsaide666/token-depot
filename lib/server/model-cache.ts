import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "./db";
import { metadataCache } from "./metadata-cache";

// A database trigger advances this version in the SAME transaction as every model
// insert/update/delete. Redis outage, process crash or a direct SQL edit cannot
// leave a stale price/disabled model addressable by the next request.
export async function modelRevision() {
  const rows = await getDb().$queryRaw<{ revision: bigint }[]>`SELECT revision FROM "ModelCacheRevision" WHERE id = 1`;
  if (!rows.length) throw new Error("Model cache revision is unavailable.");
  return rows[0].revision.toString();
}

export async function gatewayModel(slug: string) {
  const revision = await modelRevision();
  const record = await metadataCache(`model:v1:${revision}:${slug}`, 60000, async () => {
    const model = await getDb().model.findUnique({ where: { slug }, select: {
      id: true, slug: true, enabled: true, provider: true, providerModel: true, contextWindow: true,
      inputPricePerMillion: true, outputPricePerMillion: true, markupMultiplier: true,
    } });
    return model ? { ...model, inputPricePerMillion: model.inputPricePerMillion.toFixed(),
      outputPricePerMillion: model.outputPricePerMillion.toFixed(), markupMultiplier: model.markupMultiplier.toFixed() } : null;
  });
  return record ? { ...record, inputPricePerMillion: new Prisma.Decimal(record.inputPricePerMillion),
    outputPricePerMillion: new Prisma.Decimal(record.outputPricePerMillion), markupMultiplier: new Prisma.Decimal(record.markupMultiplier) } : null;
}
