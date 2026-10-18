import { json, requestFailure } from "@/lib/server/http";
import { getCurrentSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET() {
  try { const session = await getCurrentSession(); return json({ user: session?.user ?? null, expiresAt: session?.expiresAt.toISOString() ?? null }); }
  catch (error) { return requestFailure(error); }
}
