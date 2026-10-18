import type { Metadata } from "next";
import { AdminPaymentsPage } from "@/components/admin/payments-page";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { adminPageData } from "@/lib/server/admin/handlers";
import { adminPaymentsQuery } from "@/lib/server/admin/query";
import { getAdminPayments } from "@/lib/server/admin/reads";

export const metadata: Metadata = { title: "Payments" };
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, error } = await adminPageData(searchParams, adminPaymentsQuery, getAdminPayments);
  if (!data) return <DataError message={error} href="/admin/payments" />;
  return <AdminPaymentsPage key={JSON.stringify(data.query)} initialData={data} />;
}
