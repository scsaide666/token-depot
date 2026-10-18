import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/server/db";
import { applicationOrigin } from "@/lib/security/origin";
import { pageSecurityHeaders } from "@/lib/security/headers";
import { privatePath } from "@/lib/seo";

// This early guard provides real 403 responses before an HTML/RSC shell streams.
// Layouts, pages and every data/mutation handler still check the session independently.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname, playground = path === "/playground";
  const api = path === "/api/admin" || path.startsWith("/api/admin/"), admin = path === "/admin" || path.startsWith("/admin/");
  const security = pageSecurityHeaders(), headers = security.headers;
  if (privatePath(path)) headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
  // Overwrite client-supplied nonce/CSP headers before Next renders any scripts.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", security.nonce); forwarded.set("Content-Security-Policy", headers["Content-Security-Policy"]);
  const next = () => NextResponse.next({ request: { headers: forwarded } });
  const finish = (response: NextResponse) => { Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; };
  if (!admin && !api && !playground) return finish(next());
  try {
    const cookieName = process.env.NODE_ENV === "production" ? "__Host-aihub-session" : "aihub-session";
    const token = request.cookies.get(cookieName)?.value;
    const session = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? await getDb().session.findUnique({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
      select: { expiresAt: true, user: { select: { role: true, status: true } } },
    }) : null;
    if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
      if (api) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401, headers });
      return finish(NextResponse.redirect(new URL("/login", applicationOrigin(request.nextUrl.origin))));
    }
    if (!playground && session.user.role !== "ADMIN") {
      if (api) return NextResponse.json({ error: "Administrator access is required." }, { status: 403, headers });
      return new NextResponse('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Access denied · Token Depot</title></head><body style="margin:0;background:#f5f9ff;color:#0f172a;font-family:system-ui,sans-serif"><main style="max-width:440px;margin:15vh auto;padding:24px"><p>Token Depot</p><h1 style="font-weight:600;letter-spacing:-.04em">403 · Access denied</h1><p style="color:#475569">Administrator access is required.</p><a style="color:#0f4fcc" href="/dashboard">Back to Dashboard</a></main></body></html>', { status: 403, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    }
    return finish(next());
  } catch { return NextResponse.json({ error: "Administration is temporarily unavailable." }, { status: 503, headers }); }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
