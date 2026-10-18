import "server-only";
import { NextResponse } from "next/server";
import { getCurrentSession } from "./session";
import { HttpError } from "./http-error";
import { readLimitedJson } from "@/lib/ai/http";
import { RiskLimited } from "@/lib/risk/limiter";
import { RiskUnavailable } from "@/lib/risk/redis";
import { applicationOrigin } from "@/lib/security/origin";

export { HttpError } from "./http-error";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function readMutation(request: Request, bodyBytes = 8192): Promise<unknown> {
  const allowedOrigin = applicationOrigin(new URL(request.url).origin);
  if (request.headers.get("origin") !== allowedOrigin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Request origin is not allowed.");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "Send application/json.");
  try { return await readLimitedJson(request, bodyBytes, AbortSignal.any([request.signal, AbortSignal.timeout(10000)])); }
  catch (error) {
    if (error instanceof Error && error.message === "body_limit") throw new HttpError(413, "Request body is too large.");
    throw new HttpError(400, "Invalid JSON or request body timed out.");
  }
}

export async function requireApiSession() {
  const session = await getCurrentSession();
  if (!session) throw new HttpError(401, "Your session has ended. Sign in again.");
  return session;
}

export async function requireAdminApiSession() {
  const session = await requireApiSession();
  if (session.user.role !== "ADMIN") throw new HttpError(403, "Administrator access is required.");
  return session;
}

export function requestFailure(error: unknown) {
  if (error instanceof RiskLimited) {
    const response = json({ error: error.message, type: "rate_limit_error", code: "rate_limit_exceeded" }, 429);
    response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  if (error instanceof RiskUnavailable) return json({ error: error.message, type: "server_error", code: "risk_unavailable" }, 503);
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  // Do not log credentials, hashes, database URLs or submitted form values.
  console.error("Account request failed.");
  return json({ error: "We couldn’t complete this request. Please try again shortly." }, 503);
}
