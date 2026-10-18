import { adminRead } from "@/lib/server/admin/handlers";
import { adminOverviewQuery } from "@/lib/server/admin/query";
import { getAdminOverview } from "@/lib/server/admin/reads";
export const runtime = "nodejs";
export async function GET(request: Request) { return adminRead(request, adminOverviewQuery, getAdminOverview); }
