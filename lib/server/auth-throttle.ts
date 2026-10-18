import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "./db";
import { HttpError } from "./http";

const windowMs = 15 * 60 * 1000;

export async function limitAuthAttempt(email: string, action: "login" | "register") {
  const now = Date.now();
  const key = createHash("sha256").update(`${action}:${email}`).digest("hex");
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const row = await getDb().authRateLimit.upsert({ where: { key_windowStart: { key, windowStart } }, create: { key, windowStart }, update: { attempts: { increment: 1 } }, select: { attempts: true } });
  await getDb().authRateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 24 * 60 * 60 * 1000) } } });
  if (row.attempts > (action === "login" ? 20 : 10)) throw new HttpError(429, "Too many attempts. Please try again in 15 minutes.");
}
