import type { Metadata } from "next";
import { AdminOverview } from "@/components/admin/overview";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { adminPageData } from "@/lib/server/admin/handlers";
import { adminOverviewQuery } from "@/lib/server/admin/query";
import { getAdminOverview } from "@/lib/server/admin/reads";

export const metadata: Metadata = { title: { absolute: "Admin · Token Depot" } };
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, error } = await adminPageData(searchParams, adminOverviewQuery, getAdminOverview);
  if (!data) return <DataError message={error} href="/admin" />;
  return <AdminOverview key={JSON.stringify(data.query)} initialData={data} />;
}
