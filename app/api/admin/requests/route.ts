import { adminRead } from "@/lib/server/admin/handlers";
import { adminRequestsQuery } from "@/lib/server/admin/query";
import { getAdminRequests } from "@/lib/server/admin/reads";
export const runtime = "nodejs";
export async function GET(request: Request) { return adminRead(request, adminRequestsQuery, getAdminRequests); }
