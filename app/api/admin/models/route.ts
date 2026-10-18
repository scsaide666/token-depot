import { modelBody } from "@/lib/model-schemas";
import { createModel } from "@/lib/server/models";
import { adminRead } from "@/lib/server/admin/handlers";
import { adminModelsQuery } from "@/lib/server/admin/query";
import { getAdminModels } from "@/lib/server/admin/reads";
import { json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) { return adminRead(request, adminModelsQuery, getAdminModels); }
export async function POST(request: Request) {
  try {
    await requireAdminApiSession();
    const parsed = modelBody.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the model fields and try again.", fieldErrors: parsed.error.flatten().fieldErrors }, 422);
    return json({ model: await createModel(parsed.data) }, 201);
  } catch (error) { return requestFailure(error); }
}
