import { adminStatusBody, adminUserId } from "@/lib/admin-schemas";
import { getAdminUser } from "@/lib/server/admin/reads";
import { changeUserStatus } from "@/lib/server/admin/users";
import { HttpError, json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function userId(context: Context) {
  const result = adminUserId.safeParse((await context.params).id);
  if (!result.success) throw new HttpError(400, "Invalid user ID.");
  return result.data;
}
export async function GET(_request: Request, context: Context) {
  try { await requireAdminApiSession(); return json({ user: await getAdminUser(await userId(context)) }); }
  catch (error) { return requestFailure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    await requireAdminApiSession();
    const id = await userId(context), parsed = adminStatusBody.safeParse(await readMutation(request));
    if (!parsed.success) throw new HttpError(422, "Choose Active or Suspended.");
    await changeUserStatus(id, parsed.data.status);
    return json({ user: await getAdminUser(id) });
  } catch (error) { return requestFailure(error); }
}
