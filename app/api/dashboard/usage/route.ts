import { getUsage } from "@/lib/server/analytics";
import { usageQuery, parseAnalyticsQuery } from "@/lib/server/analytics-query";
import { json, requestFailure, requireApiSession } from "@/lib/server/http";
export async function GET(request: Request) {
  try { await requireApiSession(); return json(await getUsage(parseAnalyticsQuery(new URL(request.url).searchParams, usageQuery))); }
  catch (error) { return requestFailure(error); }
}
