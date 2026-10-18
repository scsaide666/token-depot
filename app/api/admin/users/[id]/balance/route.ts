import { adminAdjustmentBody, adminUserId } from "@/lib/admin-schemas";
import { adjustUserBalance } from "@/lib/server/admin/users";
import { HttpError, json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminApiSession();
    const id = adminUserId.safeParse((await context.params).id);
    if (!id.success) throw new HttpError(400, "Invalid user ID.");
    const parsed = adminAdjustmentBody.safeParse(await readMutation(request));
    if (!parsed.success) throw new HttpError(422, "Enter a valid amount and adjustment reason (3–200 characters).");
    return json({ transaction: await adjustUserBalance(id.data, parsed.data) }, 201);
  } catch (error) { return requestFailure(error); }
}
