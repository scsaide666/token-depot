import { z } from "zod";
import { getDb } from "@/lib/server/db";
import { HttpError, json, requestFailure, requireApiSession } from "@/lib/server/http";
import { limitPlayground, playgroundStats } from "@/lib/server/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Recover a lost acknowledgement without dispatching the request again.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireApiSession();
    await limitPlayground(request, user.id, "stats");
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Submission not found.");
    const run = await getDb().playgroundRun.findUnique({ where: { userId_submissionId: { userId: user.id, submissionId: id } }, select: { id: true } });
    if (!run) throw new HttpError(404, "Submission not found.");
    return json(await playgroundStats(run.id));
  } catch (error) { return requestFailure(error); }
}
