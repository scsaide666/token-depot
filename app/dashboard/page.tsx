import { DashboardOverview } from "@/components/dashboard/overview";
import { requireUser } from "@/lib/server/session";
import { getOverview } from "@/lib/server/analytics";
import { overviewQuery, parseAnalyticsQuery, pageQueryParams } from "@/lib/server/analytics-query";
import { HttpError } from "@/lib/server/http";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { publicCatalog } from "@/lib/server/models";
import { siteConfiguration } from "@/lib/seo";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  let data: Awaited<ReturnType<typeof getOverview>> | undefined, invalidFilters = "";
  try {
    const query = parseAnalyticsQuery(pageQueryParams(await searchParams), overviewQuery);
    data = await getOverview(query.range);
  } catch (error) { if (error instanceof HttpError && error.status === 400) invalidFilters = error.message; else throw error; }
  if (!data) return <DataError message={invalidFilters} href="/dashboard" />;
  const models = await publicCatalog();
  return <DashboardOverview key={data.range} initialData={data} models={models.catalog.map(({ name, slug }) => ({ name, slug }))} modelLoadError={models.loadError} apiBaseUrl={`${siteConfiguration().origin}/v1`} />;
}
