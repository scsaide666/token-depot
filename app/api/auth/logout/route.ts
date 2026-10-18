import { cookies } from "next/headers";
import { logoutSchema } from "@/lib/auth-schemas";
import { getDb } from "@/lib/server/db";
import { json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";
import { clearSessionCookie, SESSION_COOKIE, sessionTokenHash, validSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = logoutSchema.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Invalid sign-out request." }, 422);
    if (parsed.data.all) {
      const session = await requireApiSession();
      await getDb().session.deleteMany({ where: { userId: session.user.id } });
    } else {
      const token = (await cookies()).get(SESSION_COOKIE)?.value;
      if (validSessionToken(token)) await getDb().session.deleteMany({ where: { tokenHash: sessionTokenHash(token) } });
    }
    await clearSessionCookie();
    return json({ signedOut: true });
  } catch (error) { return requestFailure(error); }
}
