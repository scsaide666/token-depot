import { json, requestFailure, requireApiSession } from "@/lib/server/http";
import { limitPlayground, playgroundStats } from "@/lib/server/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireApiSession();
    await limitPlayground(request, user.id, "stats");
    return json(await playgroundStats((await params).id));
  } catch (error) { return requestFailure(error); }
}
