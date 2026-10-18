"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AccountProvider } from "@/components/auth/account-provider";
import type { AccountUser } from "@/lib/account-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DashboardSidebar, dashboardDestinationLabels, type DashboardDestination } from "./sidebar";
import { DashboardTopbar } from "./topbar";
import "./console.css";
import "./core-pages.css";

export function DashboardShell({ children, user }: { children: ReactNode; user: AccountUser }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [destination, setDestination] = useState<DashboardDestination>("profile");
  const menuRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pendingDestination = useRef<DashboardDestination | null>(null);
  const pageNavigation = useRef(false);
  const label = dashboardDestinationLabels[destination];

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function openDestination(target: DashboardDestination) {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (drawerOpen) {
      pendingDestination.current = target;
      setDrawerOpen(false);
    } else {
      setDestination(target);
      setDialogOpen(true);
    }
  }

  function restoreFocus() {
    if (triggerRef.current?.isConnected && triggerRef.current.getClientRects().length) triggerRef.current.focus();
    else if (menuRef.current?.getClientRects().length) menuRef.current.focus();
    else document.querySelector<HTMLAnchorElement>('aside [aria-current="page"]')?.focus();
  }

  return (
    <AccountProvider user={user}><div lang="en" className="dashboard-console min-h-dvh">
      <a href="#dashboard-content" className="skip-link">Skip to content</a>
      <aside aria-label="Sidebar" className="console-sidebar-rail fixed inset-y-0 left-0 z-40 hidden overflow-y-auto lg:block">
        <DashboardSidebar onPageNavigate={() => setDrawerOpen(false)} onNavigate={openDestination} />
      </aside>
      <div className="console-workspace min-w-0">
        <Sheet open={drawerOpen} onOpenChange={open => { if (open) pageNavigation.current = false; setDrawerOpen(open); }}>
          <DashboardTopbar menuRef={menuRef} onProfile={() => openDestination("profile")} />
          <SheetContent lang="en" className="dashboard-console console-drawer" onCloseAutoFocus={(event) => {
            if (pendingDestination.current) {
              event.preventDefault();
              setDestination(pendingDestination.current);
              pendingDestination.current = null;
              setDialogOpen(true);
            } else if (pageNavigation.current) {
              event.preventDefault();
              pageNavigation.current = false;
              document.getElementById("dashboard-content")?.focus({ preventScroll: true });
            } else if (!menuRef.current?.getClientRects().length) {
              event.preventDefault();
              document.querySelector<HTMLAnchorElement>('aside [aria-current="page"]')?.focus();
            }
          }}>
            <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
            <SheetDescription className="sr-only">Navigate your workspace and choose a theme.</SheetDescription>
            <DashboardSidebar mobile onPageNavigate={() => { pageNavigation.current = true; setDrawerOpen(false); }} onNavigate={openDestination} />
          </SheetContent>
        </Sheet>
        <main id="dashboard-content" tabIndex={-1} className="console-main outline-none">{children}</main>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent lang="en" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} className="dashboard-console console-profile data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed">Your Token Depot account details.</DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border/60 text-sm"><div className="flex flex-wrap justify-between gap-3 py-3"><dt className="text-muted-foreground">Name</dt><dd className="break-all">{user.name}</dd></div><div className="flex flex-wrap justify-between gap-3 py-3"><dt className="text-muted-foreground">Email</dt><dd className="break-all">{user.email}</dd></div></dl>
          <DialogFooter className="mt-3"><Button variant="secondary" onClick={() => setDialogOpen(false)}>Close</Button><Button asChild><Link href="/dashboard/settings#profile" onClick={() => setDialogOpen(false)}>Manage profile</Link></Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div></AccountProvider>
  );
}
