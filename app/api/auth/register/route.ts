import { Prisma } from "@/generated/prisma/client";
import { limitSensitiveRequest } from "@/lib/risk/sensitive";
import { registerSchema, validationFields } from "@/lib/auth-schemas";
import { accountDto, accountSelect } from "@/lib/server/account";
import { limitAuthAttempt } from "@/lib/server/auth-throttle";
import { getDb } from "@/lib/server/db";
import { json, readMutation, requestFailure } from "@/lib/server/http";
import { hashPassword } from "@/lib/server/password";
import { newSession, setSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await limitSensitiveRequest(request, "register");
    const parsed = registerSchema.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the details below.", fieldErrors: validationFields(parsed.error) }, 422);
    const { name, email, password } = parsed.data;
    await limitAuthAttempt(email, "register");
    const passwordHash = await hashPassword(password);
    const session = newSession(false, request.headers.get("user-agent") ?? "");
    const user = await getDb().$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { name, email, passwordHash, role: "USER", status: "ACTIVE", wallet: { create: { balance: new Prisma.Decimal(0), reservedBalance: new Prisma.Decimal(0) } } }, select: accountSelect });
      await transaction.session.create({ data: { userId: user.id, ...session.record } });
      return accountDto(user);
    });
    await setSessionCookie(session.token, false);
    return json({ user }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return json({ error: "An account with this email already exists.", fieldErrors: { email: "An account with this email already exists. Sign in instead." } }, 409);
    return requestFailure(error);
  }
}
