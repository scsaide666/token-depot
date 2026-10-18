"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, BookOpen, ChevronRight, CreditCard, Layers2, LayoutDashboard, LogOut, Menu, Network, Shield, Users, X } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import type { AccountUser } from "@/lib/account-types";
import { profileInitials } from "@/lib/settings-demo-data";
import { Brand } from "@/components/brand";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitch } from "@/components/theme-switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const navigation = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/models", label: "Models", icon: Layers2 },
  { href: "/admin/providers", label: "Providers", icon: Network },
  { href: "/admin/requests", label: "Requests", icon: Activity },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
] as const;

export function AdminShell({ children, user }: { children: ReactNode; user: AccountUser }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const pageNavigation = useRef(false);
  const current = navigation.find((item) => item.href === pathname)?.label ?? "Overview";

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  function sidebar(mobile = false) {
    return <div className="flex min-h-full flex-col px-4 pt-4 pb-5">
      <div className="flex h-12 items-center justify-between px-2"><Brand name="Token Depot" variant="sidebar" />{mobile && <SheetClose aria-label="Close admin navigation" className="dashboard-icon-button -mr-2"><X className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /></SheetClose>}</div>
      <div className="mt-4 mb-7 flex items-center gap-2 border-b border-border/60 px-2 pb-5 text-xs text-muted-foreground"><Shield className="size-3.5" strokeWidth={1.6} aria-hidden="true" /><span>Administration</span></div>
      <nav aria-label={mobile ? "Mobile admin navigation" : "Admin navigation"} className="space-y-1">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => { if (mobile) { pageNavigation.current = true; setDrawerOpen(false); } }} className="admin-nav-item"><Icon className="size-[17px] shrink-0" strokeWidth={1.6} aria-hidden="true" />{label}</Link>)}</nav>
      <div className="mt-auto pt-12">
        {mobile && <div className="mb-5 flex items-center justify-between gap-2 px-2"><span className="text-xs text-muted-foreground">Theme</span><ThemeSwitch language="en" /></div>}
        <nav aria-label="Admin resources" className="space-y-1 border-t border-border/60 pt-4"><Link href="/dashboard" className="admin-nav-item"><ArrowLeft className="size-[17px]" strokeWidth={1.6} aria-hidden="true" />User Dashboard</Link><Link href="/docs" className="admin-nav-item"><BookOpen className="size-[17px]" strokeWidth={1.6} aria-hidden="true" />Documentation</Link><LogoutButton className="admin-nav-item w-full justify-start"><LogOut className="size-[17px]" strokeWidth={1.6} aria-hidden="true" />Sign out</LogoutButton></nav>
      </div>
    </div>;
  }

  return <div lang="en" className="admin-console min-h-dvh bg-background">
    <a href="#admin-content" className="skip-link">Skip to content</a>
    <aside aria-label="Admin sidebar" className="admin-sidebar fixed inset-y-0 left-0 z-40 hidden w-[216px] overflow-y-auto border-r border-border/60 bg-secondary/25 lg:block">{sidebar()}</aside>
    <div className="min-w-0 lg:pl-[216px]">
      <Sheet open={drawerOpen} onOpenChange={(open) => { if (open) pageNavigation.current = false; setDrawerOpen(open); }}>
        <header className="admin-header sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-card px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2"><div className="lg:hidden"><SheetTrigger ref={menuRef} aria-label="Open admin navigation" className="dashboard-icon-button -ml-2"><Menu className="size-5" strokeWidth={1.6} aria-hidden="true" /></SheetTrigger></div><Link href="/" aria-label="Token Depot home" className="flex size-11 shrink-0 items-center justify-center lg:hidden"><BrandMark size={24} /></Link><nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-xs"><Link href="/admin" className="auth-link hidden text-muted-foreground sm:inline">Admin</Link><ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" /><span aria-current="page" className="truncate">{current}</span></nav></div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-5"><span className="rounded-[6px] border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">Admin workspace</span><div className="hidden lg:block"><ThemeSwitch language="en" /></div><span aria-label={`${user.name}, admin account`} className="flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-[10px] font-medium">{profileInitials(user.name)}</span></div>
        </header>
        <SheetContent lang="en" className="admin-console bg-background" onCloseAutoFocus={(event) => {
          if (pageNavigation.current || !menuRef.current?.getClientRects().length) { event.preventDefault(); pageNavigation.current = false; document.getElementById("admin-content")?.focus({ preventScroll: true }); }
        }}><SheetTitle className="sr-only">Admin navigation</SheetTitle><SheetDescription className="sr-only">Navigate the administration workspace.</SheetDescription>{sidebar(true)}</SheetContent>
      </Sheet>
      <main id="admin-content" tabIndex={-1} className="admin-main mx-auto w-full min-w-0 max-w-[var(--content-console)] px-4 pt-8 pb-10 outline-none sm:px-6 lg:px-8 lg:pt-9">{children}<p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">Live database records · CNY · Dates in UTC. Revenue reflects settled API usage. Wallet adjustments are recorded in the ledger.</p></main>
    </div>
  </div>;
}
