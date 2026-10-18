import { adminRead } from "@/lib/server/admin/handlers";
import { adminUsersQuery } from "@/lib/server/admin/query";
import { getAdminUsers } from "@/lib/server/admin/reads";
export const runtime = "nodejs";
export async function GET(request: Request) { return adminRead(request, adminUsersQuery, getAdminUsers); }
