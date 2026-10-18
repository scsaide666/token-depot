import { z } from "zod";
import { bindingBody, providerChildrenQuery } from "@/lib/provider-schemas";
import { getChannelBindings, saveBinding } from "@/lib/server/admin/providers";
import { parseAnalyticsQuery } from "@/lib/server/analytics-query";
import { json, readMutation, requestFailure, requireAdminApiSession } from "@/lib/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    await requireAdminApiSession();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return json({ error: "Channel not found." }, 404);
    return json(await getChannelBindings(id.data, parseAnalyticsQuery(new URL(request.url).searchParams, providerChildrenQuery)));
  } catch (error) { return requestFailure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    await requireAdminApiSession();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return json({ error: "Channel not found." }, 404);
    const parsed = bindingBody.safeParse(await readMutation(request));
    if (!parsed.success) return json({ error: "Check the model binding fields and try again." }, 422);
    return json({ binding: await saveBinding(id.data, parsed.data) });
  } catch (error) { return requestFailure(error); }
}
