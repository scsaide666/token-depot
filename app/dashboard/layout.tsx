import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireUser } from "@/lib/server/session";
import { NO_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Dashboard · Token Depot" },
  description: "An overview of your Token Depot usage, balance and API activity.",
  robots: NO_INDEX,
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
