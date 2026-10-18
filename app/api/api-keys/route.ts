import { apiKeyNameBody } from "@/lib/api-key-schemas";
import { limitSensitiveRequest } from "@/lib/risk/sensitive";
import { createApiKey, listApiKeys } from "@/lib/server/api-keys";
import { json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  try { const session = await requireApiSession(); return json({ apiKeys: await listApiKeys(session.user.id) }); }
  catch (error) { return requestFailure(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    await limitSensitiveRequest(request, "create-api-key", session.user.id);
    const parsed = apiKeyNameBody.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Enter a valid name for your API key.", fieldErrors: { name: parsed.error.issues.find((issue) => issue.path[0] === "name")?.message } }, 422);
    return json(await createApiKey(session.user.id, parsed.data.name), 201);
  } catch (error) { return requestFailure(error); }
}
