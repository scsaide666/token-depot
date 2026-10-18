"use client";

import Link from "next/link";
import type { Ref } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, Wallet } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitch } from "@/components/theme-switch";
import { SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/components/auth/account-provider";
import { profileInitials } from "@/lib/settings-demo-data";
import { dashboardPageLabel } from "./navigation";

export function DashboardTopbar({ menuRef, onProfile }: { menuRef: Ref<HTMLButtonElement>; onProfile: () => void }) {
  const user = useAccount(), pathname = usePathname(), label = dashboardPageLabel(pathname);
  return (
    <header className="console-header">
      <div className="console-header-location">
        <SheetTrigger ref={menuRef} aria-label="Open sidebar" className="dashboard-icon-button lg:hidden"><Menu size={18} strokeWidth={1.6} aria-hidden="true" /></SheetTrigger>
        <Link href="/" aria-label="Token Depot home" className="console-mobile-brand lg:hidden"><BrandMark size={24} className="rounded-[5px]" /></Link>
        <nav aria-label="Breadcrumb" className="console-breadcrumb">
          <Link href="/dashboard" className="hidden sm:inline">Workspace</Link><ChevronRight size={13} className="hidden sm:inline" aria-hidden="true" />
          {label === "Payment details" && <><Link href="/dashboard/billing" className="hidden sm:inline">Billing</Link><ChevronRight size={13} className="hidden sm:inline" aria-hidden="true" /></>}
          <span aria-current="page">{label}</span>
        </nav>
      </div>
      <div className="console-header-actions">
        <Link href="/dashboard/billing" className="console-header-balance" aria-label={`Available balance ${user.wallet.balanceDisplay}. Open billing.`}><Wallet size={13} strokeWidth={1.6} aria-hidden="true" /><span>Balance</span><strong>{user.wallet.balanceDisplay}</strong></Link>
        <div className="console-header-theme hidden lg:block"><ThemeSwitch language="en" /></div>
        <Tooltip><TooltipTrigger asChild><button type="button" aria-label="Open user profile" onClick={onProfile} className="dashboard-icon-button console-avatar"><span aria-hidden="true">{profileInitials(user.name)}</span></button></TooltipTrigger><TooltipContent>{user.name}</TooltipContent></Tooltip>
      </div>
    </header>
  );
}

