import { getOverview } from "@/lib/server/analytics";
import { overviewQuery, parseAnalyticsQuery } from "@/lib/server/analytics-query";
import { json, requestFailure, requireApiSession } from "@/lib/server/http";
export async function GET(request: Request) {
  try { await requireApiSession(); const query = parseAnalyticsQuery(new URL(request.url).searchParams, overviewQuery); return json(await getOverview(query.range)); }
  catch (error) { return requestFailure(error); }
}
