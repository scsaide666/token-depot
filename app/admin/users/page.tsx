import type { Metadata } from "next";
import { AdminUsersPage } from "@/components/admin/users-page";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { adminPageData } from "@/lib/server/admin/handlers";
import { adminUsersQuery } from "@/lib/server/admin/query";
import { getAdminUsers } from "@/lib/server/admin/reads";

export const metadata: Metadata = { title: "Users" };
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, error } = await adminPageData(searchParams, adminUsersQuery, getAdminUsers);
  if (!data) return <DataError message={error} href="/admin/users" />;
  return <AdminUsersPage key={JSON.stringify(data.query)} initialData={data} />;
}
