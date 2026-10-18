import type { Metadata } from "next";
import { UsagePage } from "@/components/dashboard/usage/usage-page";
import { requireUser } from "@/lib/server/session";
import { getUsage } from "@/lib/server/analytics";
import { usageQuery, parseAnalyticsQuery, pageQueryParams } from "@/lib/server/analytics-query";
import { HttpError } from "@/lib/server/http";
import { DataError } from "@/components/dashboard/analytics/data-states";

export const metadata: Metadata = {
  title: { absolute: "Usage · Token Depot" },
  description: "Track requests, token usage, latency and cost.",
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  let data: Awaited<ReturnType<typeof getUsage>> | undefined, invalidFilters = "";
  try {
    const query = parseAnalyticsQuery(pageQueryParams(await searchParams), usageQuery);
    data = await getUsage(query);
  } catch (error) { if (error instanceof HttpError && error.status === 400) invalidFilters = error.message; else throw error; }
  if (!data) return <DataError message={invalidFilters} href="/dashboard/usage" />;
  return <UsagePage key={JSON.stringify(data.query)} initialData={data} />;
}
