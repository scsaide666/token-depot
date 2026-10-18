import { z } from "zod";
import { providerChildrenQuery } from "@/lib/provider-schemas";
import { getChannelAttempts } from "@/lib/server/admin/providers";
import { parseAnalyticsQuery } from "@/lib/server/analytics-query";
import { json, requestFailure, requireAdminApiSession } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminApiSession();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return json({ error: "Channel not found." }, 404);
    return json(await getChannelAttempts(id.data, parseAnalyticsQuery(new URL(request.url).searchParams, providerChildrenQuery)));
  } catch (error) { return requestFailure(error); }
}
