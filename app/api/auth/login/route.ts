import { cookies } from "next/headers";
import { limitSensitiveRequest } from "@/lib/risk/sensitive";
import { recordBehavior } from "@/lib/risk/behavior";
import { loginSchema, validationFields } from "@/lib/auth-schemas";
import { accountDto, accountSelect } from "@/lib/server/account";
import { limitAuthAttempt } from "@/lib/server/auth-throttle";
import { getDb } from "@/lib/server/db";
import { json, readMutation, requestFailure } from "@/lib/server/http";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/server/password";
import { newSession, SESSION_COOKIE, sessionTokenHash, setSessionCookie, validSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const risk = await limitSensitiveRequest(request, "login");
    const parsed = loginSchema.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the details below.", fieldErrors: validationFields(parsed.error) }, 422);
    const { email, password, rememberMe } = parsed.data;
    await limitAuthAttempt(email, "login");
    const user = await getDb().user.findUnique({ where: { email }, select: { ...accountSelect, passwordHash: true } });
    const matches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !matches || user.status !== "ACTIVE") {
      await recordBehavior("failed_requests", risk);
      return json({ error: "Email or password is incorrect, or the account is unavailable." }, 401);
    }
    const session = newSession(rememberMe, request.headers.get("user-agent") ?? "");
    const oldToken = (await cookies()).get(SESSION_COOKIE)?.value;
    await getDb().$transaction(async (transaction) => {
      if (validSessionToken(oldToken)) await transaction.session.deleteMany({ where: { tokenHash: sessionTokenHash(oldToken) } });
      await transaction.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
      await transaction.session.create({ data: { userId: user.id, ...session.record } });
    });
    await setSessionCookie(session.token, rememberMe);
    return json({ user: accountDto(user) });
  } catch (error) { return requestFailure(error); }
}
