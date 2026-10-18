"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FlaskConical, Menu, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { docsSections, type DocsSectionId } from "@/lib/docs-content";
import { DocsSearch } from "./docs-search";

export function DocsShell({ children }: { children: ReactNode }) {
  const [reading, setReading] = useState<{ section: DocsSectionId; topic: string }>({ section: docsSections[0].id, topic: docsSections[0].id });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const pendingAnchor = useRef<string | null>(null);
  const current = docsSections.find((section) => section.id === reading.section) ?? docsSections[0];

  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      const headings = [...document.querySelectorAll<HTMLElement>('[data-docs-heading]')];
      const activationLine = Math.max(200, Math.min(240, window.innerHeight * 0.25));
      let heading = headings[0];
      for (const item of headings) { if (item.getBoundingClientRect().top <= activationLine) heading = item; else break; }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) heading = headings.at(-1) ?? heading;
      const section = heading?.closest('[data-docs-section]')?.getAttribute('data-docs-section');
      const match = docsSections.find((item) => item.id === section);
      if (match && heading) setReading((previous) => previous.section === match.id && previous.topic === heading.id ? previous : { section: match.id, topic: heading.id });
    }
    function queueUpdate() { if (!frame) frame = requestAnimationFrame(update); }
    function onResize() {
      if (window.innerWidth >= 1024) { setDrawerOpen(false); setTocOpen(false); }
      queueUpdate();
    }
    queueUpdate();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("hashchange", queueUpdate);
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", queueUpdate); window.removeEventListener("hashchange", queueUpdate); window.removeEventListener("resize", onResize); };
  }, []);

  function selectSection(id: DocsSectionId, mobile = false) {
    if (mobile) { pendingAnchor.current = id; setDrawerOpen(false); }
    setTocOpen(false);
  }

  function sectionsNavigation(mobile = false) {
    return <nav aria-label={mobile ? "Mobile documentation sections" : "Documentation sections"} className="space-y-1">{docsSections.map((section) => <a key={section.id} href={`#${section.id}`} aria-current={reading.section === section.id ? "location" : undefined} onClick={() => selectSection(section.id, mobile)} className="docs-section-link">{section.label}</a>)}</nav>;
  }

  function topicsNavigation(mobile = false) {
    return <nav aria-label={mobile ? "Mobile page contents" : "On this page"} className="mt-3 space-y-1">{current.topics.map((topic) => <a key={topic.id} href={`#${topic.id}`} aria-current={reading.topic === topic.id ? "location" : undefined} onClick={() => { setTocOpen(false); }} className="docs-topic-link">{topic.label}</a>)}</nav>;
  }

  return <div lang="en" className="developer-docs min-h-dvh bg-card">
    <a href="#docs-content" className="skip-link">Skip to documentation</a>
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-[var(--content-developer)] items-center justify-between gap-2 px-4 sm:gap-4 sm:px-8">
        <div className="flex items-center gap-5"><Brand name="Token Depot" /><span className="hidden text-[13px] text-muted-foreground md:inline">Documentation</span></div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-5"><DocsSearch /><Link href="/playground" aria-label="Playground" className="docs-header-link flex min-h-10 min-w-8 items-center justify-center rounded-sm text-xs"><FlaskConical className="size-4 sm:hidden" aria-hidden="true" /><span className="hidden sm:inline">Playground</span></Link><Link href="/dashboard" className="docs-header-link hidden text-xs sm:inline">Dashboard</Link><div className="hidden sm:block"><ThemeSwitch language="en" /></div></div>
      </div>
    </header>
    <Sheet open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (open) setTocOpen(false); }}>
      <div className="docs-mobile-navigation sticky top-16 z-30 border-b border-border bg-card px-4 sm:px-8 lg:hidden">
        <div className="mx-auto flex h-12 max-w-[720px] items-center justify-between gap-4">
          <SheetTrigger aria-label="Open documentation sections" className="docs-header-link -ml-2 flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-xs"><Menu className="size-4" strokeWidth={1.6} aria-hidden="true" />Sections</SheetTrigger>
          <Popover open={tocOpen} onOpenChange={setTocOpen}>
            <PopoverTrigger className="docs-header-link ui-pressable -mr-2 flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-xs">On this page<ChevronDown className="size-3.5" strokeWidth={1.6} aria-hidden="true" /></PopoverTrigger>
            <PopoverContent lang="en" align="end" aria-label="On this page" className="developer-docs w-56"><p className="text-xs font-medium">{current.label}</p>{topicsNavigation(true)}</PopoverContent>
          </Popover>
        </div>
      </div>
      <SheetContent lang="en" className="developer-docs" onCloseAutoFocus={(event) => {
        if (pendingAnchor.current) {
          event.preventDefault();
          const target = document.getElementById(pendingAnchor.current);
          pendingAnchor.current = null;
          target?.focus({ preventScroll: true });
          requestAnimationFrame(() => target?.scrollIntoView({ block: "start", behavior: "instant" }));
        }
      }}>
        <div className="flex h-full min-h-[420px] flex-col px-5 py-6">
          <div className="flex items-center justify-between gap-2"><SheetTitle className="text-base font-semibold">Documentation</SheetTitle><SheetClose aria-label="Close documentation sections" className="dashboard-icon-button -mr-2"><X className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /></SheetClose></div>
          <SheetDescription className="mt-1 text-xs text-muted-foreground">Token Depot API reference and examples.</SheetDescription>
          <div className="mt-7">{sectionsNavigation(true)}</div>
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4 sm:hidden"><span className="text-xs text-muted-foreground">Appearance</span><ThemeSwitch language="en" /></div>
          <Link href="/dashboard" className="docs-header-link mt-auto border-t border-border pt-5 text-xs">Back to dashboard</Link>
        </div>
      </SheetContent>
    </Sheet>
    <div className="docs-layout mx-auto grid max-w-[var(--content-developer)] gap-8 px-5 sm:px-8">
      <aside aria-label="Documentation sidebar" className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto py-12 pr-2 lg:block">
        <p className="mb-5 px-3 text-xs font-medium text-muted-foreground">API Reference</p>{sectionsNavigation()}
      </aside>
      <main id="docs-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[720px] pt-10 pb-20 outline-none sm:pt-12 lg:pt-14">{children}</main>
      <aside aria-label="Current page contents" className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto py-14 lg:block"><p className="text-xs font-medium">On this page</p><p className="mt-2 text-[11px] text-muted-foreground">{current.label}</p>{topicsNavigation()}</aside>
    </div>
  </div>;
}
