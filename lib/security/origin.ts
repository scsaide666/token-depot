import "server-only";
import { HttpError } from "@/lib/server/http-error";

export function applicationOrigin(fallback?: string, env: NodeJS.ProcessEnv = process.env) {
  const value = env.APP_ORIGIN;
  if (!value) {
    if (env.NODE_ENV === "production" || !fallback) throw new HttpError(503, "Application origin is not configured.");
    return new URL(fallback).origin;
  }
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error();
    return url.origin;
  } catch { throw new HttpError(503, "Application origin is not configured."); }
}
