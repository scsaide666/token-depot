import { adminRead } from "@/lib/server/admin/handlers";
import { adminPaymentsQuery } from "@/lib/server/admin/query";
import { getAdminPayments } from "@/lib/server/admin/reads";
export const runtime = "nodejs";
export async function GET(request: Request) { return adminRead(request, adminPaymentsQuery, getAdminPayments); }
