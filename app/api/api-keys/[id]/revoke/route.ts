import { apiKeyEmptyBody, apiKeyIdSchema } from "@/lib/api-key-schemas";
import { revokeApiKey } from "@/lib/server/api-keys";
import { HttpError, json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const id = apiKeyIdSchema.safeParse((await context.params).id);
    if (!id.success) throw new HttpError(404, "API key not found.");
    if (!apiKeyEmptyBody.safeParse(await readMutation(request)).success) throw new HttpError(422, "Invalid revoke request.");
    return json({ apiKey: await revokeApiKey(session.user.id, id.data) });
  } catch (error) { return requestFailure(error); }
}
