import { getBilling } from "@/lib/server/analytics";
import { billingQuery, parseAnalyticsQuery } from "@/lib/server/analytics-query";
import { json, requestFailure, requireApiSession } from "@/lib/server/http";
export async function GET(request: Request) {
  try { await requireApiSession(); return json(await getBilling(parseAnalyticsQuery(new URL(request.url).searchParams, billingQuery))); }
  catch (error) { return requestFailure(error); }
}
