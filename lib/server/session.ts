import "server-only";
import { cache } from "react";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { getDb } from "./db";
import { accountDto, accountSelect } from "./account";
import type { AccountSession } from "@/lib/account-types";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-aihub-session" : "aihub-session";
export const SESSION_DURATION = 24 * 60 * 60 * 1000;
export const REMEMBER_DURATION = 30 * SESSION_DURATION;
export const sessionTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const validSessionToken = (token: string | undefined): token is string => !!token && /^[A-Za-z0-9_-]{43}$/.test(token);

export function newSession(remember: boolean, userAgent: string) {
  const token = randomBytes(32).toString("base64url");
  return { token, record: { tokenHash: sessionTokenHash(token), expiresAt: new Date(Date.now() + (remember ? REMEMBER_DURATION : SESSION_DURATION)), userAgent: userAgent.slice(0, 200) } };
}

export async function setSessionCookie(token: string, remember: boolean) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", ...(remember ? { maxAge: REMEMBER_DURATION / 1000 } : {}) });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

// React cache deduplicates only within a render/request. No cross-user caching.
export const getCurrentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!validSessionToken(token)) return null;
  const session = await getDb().session.findUnique({ where: { tokenHash: sessionTokenHash(token) }, select: { id: true, expiresAt: true, user: { select: accountSelect } } });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  return { id: session.id, expiresAt: session.expiresAt, user: accountDto(session.user) };
});

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") forbidden();
  return user;
}

export async function redirectAuthenticated() {
  const session = await getCurrentSession();
  if (session) redirect(session.user.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function getAccountSessions(): Promise<AccountSession[]> {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const sessions = await getDb().session.findMany({ where: { userId: current.user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, expiresAt: true, userAgent: true } });
  return sessions.map((session) => ({ id: session.id, createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString(), current: session.id === current.id, device: /Edg\//.test(session.userAgent) ? "Microsoft Edge" : /Chrome\//.test(session.userAgent) ? "Chrome" : /Firefox\//.test(session.userAgent) ? "Firefox" : /Safari\//.test(session.userAgent) ? "Safari" : "Web session" }));
}
