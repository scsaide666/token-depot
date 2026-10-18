import type { Metadata } from "next";
import { AdminProvidersPage } from "@/components/admin/providers-page";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { adminPageData } from "@/lib/server/admin/handlers";
import { providersQuery } from "@/lib/provider-schemas";
import { getAdminProviders } from "@/lib/server/admin/providers";
export const metadata: Metadata = { title: "Providers" };
export default async function ProvidersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, error } = await adminPageData(searchParams, providersQuery, getAdminProviders);
  if (!data) return <DataError message={error} href="/admin/providers" />;
  return <AdminProvidersPage key={JSON.stringify(data.query)} initialData={data} />;
}
