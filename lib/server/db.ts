import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const singleton = globalThis as unknown as { aihubPrisma?: PrismaClient };
function poolInteger(name: string, fallback: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum) throw new Error("Invalid database pool configuration.");
  return Number(raw);
}

export function getDb() {
  if (singleton.aihubPrisma) return singleton.aihubPrisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  // adapter-pg normalizes timestamp offsets as UTC; the connection must use UTC too.
  const adapter = new PrismaPg({ connectionString, options: "-c timezone=UTC",
    max: poolInteger("DATABASE_POOL_MAX", 10, 100),
    connectionTimeoutMillis: poolInteger("DATABASE_POOL_TIMEOUT_MS", 5000, 60000),
    idleTimeoutMillis: poolInteger("DATABASE_POOL_IDLE_MS", 30000, 600000),
    maxLifetimeSeconds: poolInteger("DATABASE_POOL_LIFETIME_SECONDS", 1800, 86400),
  });
  singleton.aihubPrisma = new PrismaClient({ adapter, log: [] });
  return singleton.aihubPrisma;
}
