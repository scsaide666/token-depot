import { modelId, modelPatchBody } from "@/lib/model-schemas";
import { updateModel } from "@/lib/server/models";
import { HttpError, json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";

export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminApiSession();
    const { id } = await params;
    if (!modelId.safeParse(id).success) throw new HttpError(404, "This model no longer exists. Refresh and try again.");
    const parsed = modelPatchBody.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the model fields and try again.", fieldErrors: parsed.error.flatten().fieldErrors }, 422);
    return json({ model: await updateModel(id, parsed.data) });
  } catch (error) { return requestFailure(error); }
}
