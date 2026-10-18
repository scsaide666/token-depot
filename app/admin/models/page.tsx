import type { Metadata } from "next";
import { AdminModelsPage } from "@/components/admin/models-page";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { adminPageData } from "@/lib/server/admin/handlers";
import { adminModelsQuery } from "@/lib/server/admin/query";
import { getAdminModels } from "@/lib/server/admin/reads";

export const metadata: Metadata = { title: "Models" };
export default async function ModelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, error } = await adminPageData(searchParams, adminModelsQuery, getAdminModels);
  if (!data) return <DataError message={error} href="/admin/models" />;
  return <AdminModelsPage key={JSON.stringify(data.query)} initialData={data} />;
}
