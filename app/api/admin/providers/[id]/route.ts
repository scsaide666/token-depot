import { z } from "zod";
import { channelPatch } from "@/lib/provider-schemas";
import { updateChannel } from "@/lib/server/admin/providers";
import { json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminApiSession();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return json({ error: "Channel not found." }, 404);
    const parsed = channelPatch.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the channel fields and try again." }, 422);
    return json({ channel: await updateChannel(id.data, parsed.data) });
  } catch (error) { return requestFailure(error); }
}
