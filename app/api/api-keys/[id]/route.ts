import { apiKeyEmptyBody, apiKeyIdSchema, apiKeyNameBody } from "@/lib/api-key-schemas";
import { deleteApiKey, renameApiKey } from "@/lib/server/api-keys";
import { HttpError, json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireApiSession();
    const id = apiKeyIdSchema.safeParse((await context.params).id);
    if (!id.success) throw new HttpError(404, "API key not found.");
    const parsed = apiKeyNameBody.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Only a valid key name can be updated.", fieldErrors: { name: parsed.error.issues.find((issue) => issue.path[0] === "name")?.message } }, 422);
    return json({ apiKey: await renameApiKey(session.user.id, id.data, parsed.data.name) });
  } catch (error) { return requestFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireApiSession();
    const id = apiKeyIdSchema.safeParse((await context.params).id);
    if (!id.success) throw new HttpError(404, "API key not found.");
    if (!apiKeyEmptyBody.safeParse(await readMutation(request)).success) throw new HttpError(422, "Invalid delete request.");
    await deleteApiKey(session.user.id, id.data);
    return json({ deleted: true });
  } catch (error) { return requestFailure(error); }
}
