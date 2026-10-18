import type { Metadata } from "next";
import { BillingPage } from "@/components/dashboard/billing/billing-page";
import { requireUser } from "@/lib/server/session";
import { getBilling } from "@/lib/server/analytics";
import { billingQuery, parseAnalyticsQuery, pageQueryParams } from "@/lib/server/analytics-query";
import { HttpError } from "@/lib/server/http";
import { DataError } from "@/components/dashboard/analytics/data-states";

export const metadata: Metadata = {
  title: { absolute: "Billing · Token Depot" },
  description: "Manage your balance, spending and transaction history.",
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  let data: Awaited<ReturnType<typeof getBilling>> | undefined, invalidFilters = "";
  try {
    const query = parseAnalyticsQuery(pageQueryParams(await searchParams), billingQuery);
    data = await getBilling(query);
  } catch (error) { if (error instanceof HttpError && error.status === 400) invalidFilters = error.message; else throw error; }
  if (!data) return <DataError message={invalidFilters} href="/dashboard/billing" />;
  return <BillingPage key={JSON.stringify([data.pagination, data.rechargePagination, data.availableBalance, data.recharges.map((row) => [row.id, row.status])])} initialData={data} />;
}
