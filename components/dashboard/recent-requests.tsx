import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { RequestRecord } from "@/lib/analytics-types";
import { RequestTable } from "./analytics/request-table";
export function DashboardRecentRequests({ records }: { records: RequestRecord[] }) {
  return <section aria-labelledby="dashboard-recent-heading" className="overview-recent-requests"><div className="overview-section-header"><div><h2 id="dashboard-recent-heading">Recent API Requests</h2><p>Your latest calls, with usage, costs, and status.</p></div><Link href="/dashboard/usage" className="console-text-link">View all requests <ArrowUpRight size={14} aria-hidden="true" /></Link></div><RequestTable records={records} label="Recent requests" /></section>;
}

