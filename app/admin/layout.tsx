import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/server/session";
import { NO_INDEX } from "@/lib/seo";

export const metadata: Metadata = { title: { default: "Admin · Token Depot", template: "%s · Admin · Token Depot" }, description: "Token Depot administration and model management.", robots: NO_INDEX };
export default async function AdminLayout({ children }: { children: ReactNode }) { const user = await requireAdmin(); return <AdminShell user={user}>{children}</AdminShell>; }
