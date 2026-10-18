import { Prisma } from "@/generated/prisma/client";
import { profileSchema, validationFields } from "@/lib/auth-schemas";
import { accountDto, accountSelect } from "@/lib/server/account";
import { getDb } from "@/lib/server/db";
import { HttpError, json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  try { return json({ user: (await requireApiSession()).user }); }
  catch (error) { return requestFailure(error); }
}

export async function PATCH(request: Request) {
  try {
    const body = await readMutation(request);
    const session = await requireApiSession();
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return json({ error: "Only a valid name can be updated.", fieldErrors: validationFields(parsed.error) }, 422);
    // Identity comes exclusively from the verified server session.
    const user = await getDb().user.update({ where: { id: session.user.id, status: "ACTIVE" }, data: { name: parsed.data.name }, select: accountSelect }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new HttpError(409, "Your profile could not be updated. Sign in again and retry.");
      throw error;
    });
    return json({ user: accountDto(user) });
  } catch (error) { return requestFailure(error); }
}
