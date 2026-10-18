import type { Metadata } from "next";
import { AdminRequestsPage } from "@/components/admin/requests-page";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { adminPageData } from "@/lib/server/admin/handlers";
import { adminRequestsQuery } from "@/lib/server/admin/query";
import { getAdminRequests } from "@/lib/server/admin/reads";

export const metadata: Metadata = { title: "Requests" };
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, error } = await adminPageData(searchParams, adminRequestsQuery, getAdminRequests);
  if (!data) return <DataError message={error} href="/admin/requests" />;
  return <AdminRequestsPage key={JSON.stringify(data.query)} initialData={data} />;
}
