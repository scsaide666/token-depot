import { handleChatCompletion } from "@/lib/ai/gateway";
import { CHAT_LIMITS } from "@/lib/ai/types/limits";
import { getDb } from "@/lib/server/db";
import { json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";
import { claimPlaygroundRun, limitPlayground, playgroundInput } from "@/lib/server/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await requireApiSession();
    await limitPlayground(request, user.id, "submit");
    const { input, submissionId } = await playgroundInput(await readMutation(request, CHAT_LIMITS.bodyBytes));
    const { run, duplicate } = await claimPlaygroundRun(user.id, submissionId);
    if (duplicate) {
      const response = json({ error: { message: "This submission has already been sent. Check its result before sending again.", type: "invalid_request_error", code: "submission_already_exists" }, requestId: run.id }, 409);
      response.headers.set("X-Request-Id", run.id); return response;
    }
    const headers = new Headers(request.headers);
    headers.delete("authorization"); headers.delete("content-length");
    headers.set("content-type", "application/json");
    const gatewayRequest = new Request(request.url, { method: "POST", headers, body: JSON.stringify(input), signal: request.signal });
    const response = await handleChatCompletion(gatewayRequest, { playgroundRunId: run.id });
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      await getDb().playgroundRun.updateMany({ where: { id: run.id, userId: user.id, rejectedAt: null }, data: { rejectedAt: new Date(), errorCode: body?.error?.code ?? "request_rejected" } });
    }
    return response;
  } catch (error) { return requestFailure(error); }
}
