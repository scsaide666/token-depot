import { BookOpen, ChartNoAxesCombined, FlaskConical, KeyRound, Layers2, LayoutDashboard, Wallet } from "lucide-react";

export const dashboardNavigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/dashboard" },
  { id: "api-keys", label: "API Keys", icon: KeyRound, href: "/dashboard/api-keys" },
  { id: "models", label: "Models", icon: Layers2, href: "/dashboard/models" },
  { id: "usage", label: "Usage", icon: ChartNoAxesCombined, href: "/dashboard/usage" },
  { id: "billing", label: "Billing", icon: Wallet, href: "/dashboard/billing" },
  { id: "documentation", label: "Documentation", icon: BookOpen, href: "/docs" },
  { id: "playground", label: "Playground", icon: FlaskConical, href: "/playground" },
] as const;

export function dashboardPageLabel(pathname: string) {
  if (pathname.startsWith("/dashboard/billing/payments/")) return "Payment details";
  if (pathname === "/dashboard/settings" || pathname.startsWith("/dashboard/settings/")) return "Settings";
  return dashboardNavigation.find(item => pathname === item.href || item.href !== "/dashboard" && pathname.startsWith(item.href + "/"))?.label ?? "Overview";
}
export function dashboardLinkActive(pathname: string, href: string) {
  return pathname === href || href !== "/dashboard" && pathname.startsWith(href + "/");
}

