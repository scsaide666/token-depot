"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Layers2, LogOut, Settings2, X } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { Brand } from "@/components/brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { SheetClose } from "@/components/ui/sheet";
import { useAccount } from "@/components/auth/account-provider";
import { dashboardLinkActive, dashboardNavigation } from "./navigation";

export type DashboardDestination = "profile";
export const dashboardDestinationLabels: Record<DashboardDestination, string> = { profile: "User Profile" };

export function DashboardSidebar({ mobile = false, onPageNavigate, onNavigate }: {
  mobile?: boolean; onPageNavigate: () => void; onNavigate: (destination: DashboardDestination) => void;
}) {
  const pathname = usePathname(), user = useAccount();
  return (
    <div className="console-sidebar">
      <div className="console-brand">
        <Brand name="Token Depot" variant="sidebar" />
        {mobile && <SheetClose aria-label="Close sidebar" className="dashboard-icon-button"><X size={18} aria-hidden="true" /></SheetClose>}
      </div>
      <div className="console-workspace-name"><span className="console-workspace-symbol" aria-hidden="true"><Layers2 size={15} strokeWidth={1.6} /></span><div><strong>My workspace</strong><span>Personal account</span></div></div>
      <nav aria-label={mobile ? "Mobile dashboard navigation" : "Dashboard navigation"} className="console-navigation">
        {dashboardNavigation.map(({ id, label, icon: Icon, href }) => (
          <Link key={id} id={mobile ? `mobile-dashboard-${id}` : `dashboard-${id}-link`} href={href} aria-current={dashboardLinkActive(pathname, href) ? "page" : undefined} onClick={onPageNavigate} className="dashboard-nav-item">
            <Icon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />{label}
          </Link>
        ))}
      </nav>
      <div className="console-sidebar-bottom">
        {mobile && <div className="console-mobile-theme"><span>Appearance</span><ThemeSwitch language="en" /></div>}
        <nav aria-label="Account navigation" className="console-account-nav">
          <Link href="/dashboard/settings" aria-current={dashboardLinkActive(pathname, "/dashboard/settings") ? "page" : undefined} onClick={onPageNavigate} className="dashboard-nav-item"><Settings2 size={16} strokeWidth={1.6} aria-hidden="true" />Settings</Link>
          <LogoutButton className="dashboard-nav-item w-full justify-start"><LogOut size={16} strokeWidth={1.6} aria-hidden="true" />Sign out</LogoutButton>
        </nav>
        <button type="button" aria-label="Open user profile" onClick={() => onNavigate("profile")} className="console-profile-link"><CircleUserRound size={18} strokeWidth={1.6} aria-hidden="true" /><span><strong>{user.name}</strong><span>{user.email}</span></span></button>
      </div>
    </div>
  );
}

