import "server-only";
import { randomBytes } from "node:crypto";

export function pageSecurityHeaders(production = process.env.NODE_ENV === "production", secureOrigin = process.env.APP_ORIGIN?.startsWith("https://")) {
  const nonce = randomBytes(18).toString("base64");
  const csp = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'", `connect-src 'self'${production ? "" : " ws: wss:"}`, "img-src 'self' data: blob:", "font-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", ...(production && secureOrigin ? ["upgrade-insecure-requests"] : [])].join("; ");
  const headers: Record<string, string> = { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cache-Control": "no-store",
    ...(production && secureOrigin ? { "Strict-Transport-Security": "max-age=31536000" } : {}) };
  return { nonce, headers };
}
