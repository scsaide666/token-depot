import { listPublicModels } from "@/lib/server/models";
import { json, requestFailure } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET() {
  try { return json({ models: await listPublicModels() }); }
  catch (error) { return requestFailure(error); }
}
