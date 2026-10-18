"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { homeNavigation } from "@/lib/home-navigation";

export function HomeNavbar({ currentPage, loginLabel = "Sign in" }: { currentPage?: "pricing" | "models"; loginLabel?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function onResize() {
      if (window.innerWidth >= 768) setMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className="home-navbar sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-[calc(var(--content-public)+4rem)] items-center justify-between gap-6 px-5 sm:px-8">
        <Brand name="Token Depot" />
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex">
          {homeNavigation.map(({ label, destination }) => <Link key={destination} href={`/${destination}`} aria-current={destination === currentPage ? "page" : undefined} className="home-nav-link">{label}</Link>)}
        </nav>
        <div className="hidden items-center gap-6 md:flex">
          <Link href="/login" className="home-nav-link">{loginLabel}</Link>
          <Button size="sm" asChild className="h-8 px-3 text-xs"><Link href="/register">Get Started</Link></Button>
        </div>
        <button
          ref={menuButtonRef}
          id="mobile-menu-button"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex size-11 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
        >
          {menuOpen ? <X className="size-5" strokeWidth={1.6} aria-hidden="true" /> : <Menu className="size-5" strokeWidth={1.6} aria-hidden="true" />}
        </button>
      </div>
      <nav id="mobile-navigation" aria-label="Mobile navigation" hidden={!menuOpen} inert={!menuOpen} className="ui-disclosure absolute top-full inset-x-0 max-h-[calc(100dvh-4rem-var(--safe-top))] overflow-y-auto overscroll-contain border-b border-border bg-card px-6 pt-3 pb-[max(24px,var(--safe-bottom))] shadow-none md:hidden">
        {homeNavigation.map(({ label, destination }) => <Link key={destination} href={`/${destination}`} aria-current={destination === currentPage ? "page" : undefined} onClick={() => setMenuOpen(false)} className="home-nav-link block w-full py-3 text-left text-base">{label}</Link>)}
        <div className="mt-3 flex items-center justify-between border-t border-border pt-5">
          <Link href="/login" onClick={() => setMenuOpen(false)} className="home-nav-link text-sm">{loginLabel}</Link>
          <Button size="sm" asChild><Link href="/register" onClick={() => setMenuOpen(false)}>Get Started</Link></Button>
        </div>
      </nav>
    </header>
  );
}
