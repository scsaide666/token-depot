import { channelBody, providersQuery } from "@/lib/provider-schemas";
import { adminRead } from "@/lib/server/admin/handlers";
import { createChannel, getAdminProviders } from "@/lib/server/admin/providers";
import { json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) { return adminRead(request, providersQuery, getAdminProviders); }
export async function POST(request: Request) {
  try {
    await requireAdminApiSession();
    const parsed = channelBody.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the channel fields and try again.", fieldErrors: parsed.error.flatten().fieldErrors }, 422);
    return json({ channel: await createChannel(parsed.data) }, 201);
  } catch (error) { return requestFailure(error); }
}
