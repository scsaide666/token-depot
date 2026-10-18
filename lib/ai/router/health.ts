import "server-only";
import { Prisma, type ProviderChannel } from "@/generated/prisma/client";
import { getDb } from "@/lib/server/db";
import type { ChannelStats, HealthWindow } from "@/lib/provider-types";
import { money } from "@/lib/billing/money";
import { metadataCache } from "@/lib/server/metadata-cache";

export const windows = { "5m": 300000, "1h": 3600000, "24h": 86400000 } as const;
export const providerFaults = ["provider_timeout", "provider_unavailable", "provider_auth_error", "provider_rate_limit", "provider_attempt_expired", "streaming_interrupted", "usage_missing"];
type Metric = { channelId: string; period: HealthWindow; requests: bigint; successes: bigint; errors: bigint; completed: bigint; latency: number | null; cost: Prisma.Decimal; unknown: bigint };
export const emptyStats = (): ChannelStats => ({ requests: "0", successes: "0", errors: "0", averageLatency: null, successRate: null, errorRate: null, cost: "0", unknownCosts: "0" });
export async function channelStatistics(ids: string[], now = new Date()) {
  const result = new Map<string, Record<HealthWindow, ChannelStats>>();
  for (const id of ids) result.set(id, { "5m": emptyStats(), "1h": emptyStats(), "24h": emptyStats() });
  if (!ids.length) return result;
  const rows = await getDb().$queryRaw<Metric[]>(Prisma.sql`
    WITH ranges AS (SELECT * FROM (VALUES ('5m',${new Date(now.getTime() - windows["5m"])}::timestamptz),
      ('1h',${new Date(now.getTime() - windows["1h"])}::timestamptz),('24h',${new Date(now.getTime() - windows["24h"])}::timestamptz)) v(period,start)),
    selected AS (SELECT a.*,r.period FROM "ProviderAttempt" a JOIN ranges r ON a."createdAt" >= r.start
      WHERE a."channelId" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND a."createdAt" >= ${new Date(now.getTime() - windows["24h"])} AND a."createdAt" <= ${now}),
    costs AS (SELECT "channelId",period,"executionGroup",MAX("providerCost") AS cost,
      BOOL_OR("costStatus" = 'PENDING_RECONCILIATION') AS unknown FROM selected GROUP BY "channelId",period,"executionGroup"),
    totals AS (SELECT "channelId",period,COALESCE(SUM(cost) FILTER (WHERE NOT unknown),0) AS cost,COUNT(*) FILTER (WHERE unknown)::bigint AS unknown FROM costs GROUP BY "channelId",period)
    SELECT s."channelId",s.period,COUNT(*)::bigint AS requests,COUNT(*) FILTER (WHERE s.status = 'SUCCESS')::bigint AS successes,
      COUNT(*) FILTER (WHERE s.status = 'FAILED' AND s."errorCode" IN (${Prisma.join(providerFaults)}))::bigint AS errors,
      COUNT(*) FILTER (WHERE s.status <> 'PENDING')::bigint AS completed,
      AVG(s."latencyMs") FILTER (WHERE s.status <> 'PENDING')::double precision AS latency,t.cost,t.unknown
      FROM selected s JOIN totals t ON t."channelId" = s."channelId" AND t.period = s.period GROUP BY s."channelId",s.period,t.cost,t.unknown
  `);
  for (const row of rows) result.get(row.channelId)![row.period] = { requests: row.requests.toString(), successes: row.successes.toString(), errors: row.errors.toString(),
    averageLatency: row.latency === null ? null : Math.round(row.latency), successRate: row.completed ? Number(row.successes) / Number(row.completed) : null,
    errorRate: row.completed ? Number(row.errors) / Number(row.completed) : null, cost: money(row.cost).toFixed(20), unknownCosts: row.unknown.toString() };
  return result;
}
// Request routing reads only five minutes of health counters. Cost reconciliation
// and longer time windows belong to the admin read path, not every API dispatch.
export async function routingStatistics(ids: string[], now?: Date): Promise<Map<string, ChannelStats>> {
  if (now) return queryRoutingStatistics(ids, now);
  const unique = [...new Set(ids)].sort();
  // Competing channels need fresh ranking: even a short stale window can choose
  // a degraded preferred channel. A single compatible channel has no ranking
  // alternative; its circuit/capacity decision still uses locked current rows.
  if (unique.length !== 1) return queryRoutingStatistics(unique, new Date());
  // Short-lived ranking hints only; channel flags, circuit probes and capacity
  // are still checked under the database row lock for every admitted attempt.
  const rows = await metadataCache(`health:v1:${unique.join(",")}`, 1000,
    async () => [...await queryRoutingStatistics(unique, new Date())]);
  return new Map(rows);
}
async function queryRoutingStatistics(ids: string[], now: Date) {
  const result = new Map(ids.map(id => [id, emptyStats()]));
  if (!ids.length) return result;
  const rows = await getDb().$queryRaw<Omit<Metric, "period" | "cost" | "unknown">[]>(Prisma.sql`
    SELECT "channelId",COUNT(*)::bigint AS requests,COUNT(*) FILTER (WHERE status = 'SUCCESS')::bigint AS successes,
      COUNT(*) FILTER (WHERE status = 'FAILED' AND "errorCode" IN (${Prisma.join(providerFaults)}))::bigint AS errors,
      COUNT(*) FILTER (WHERE status <> 'PENDING')::bigint AS completed,AVG("latencyMs") FILTER (WHERE status <> 'PENDING')::double precision AS latency
    FROM "ProviderAttempt" WHERE "channelId" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
      AND "createdAt" >= ${new Date(now.getTime() - windows["5m"])} AND "createdAt" <= ${now} GROUP BY "channelId"
  `);
  for (const row of rows) result.set(row.channelId, { ...emptyStats(), requests: row.requests.toString(), successes: row.successes.toString(), errors: row.errors.toString(),
    averageLatency: row.latency === null ? null : Math.round(row.latency), successRate: row.completed ? Number(row.successes) / Number(row.completed) : null,
    errorRate: row.completed ? Number(row.errors) / Number(row.completed) : null });
  return result;
}
export function channelHealth(channel: Pick<ProviderChannel, "enabled" | "circuitState" | "openedUntil" | "rateLimitedUntil">, configured: boolean, stats: ChannelStats, now = Date.now()): "Healthy" | "Degraded" | "Offline" {
  if (!channel.enabled || !configured || channel.circuitState === "OPEN" && (!channel.openedUntil || channel.openedUntil.getTime() > now)) return "Offline";
  if (channel.circuitState !== "CLOSED" || channel.rateLimitedUntil && channel.rateLimitedUntil.getTime() > now || stats.successRate === null || (stats.errorRate ?? 0) > 0.05 || (stats.averageLatency ?? 0) > 3000) return "Degraded";
  return "Healthy";
}
