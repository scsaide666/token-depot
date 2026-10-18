"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { destinationDetails, type HomeDestination, type HomeDialogDestination } from "@/lib/home-navigation";
import { HomeNavbar } from "./navbar";
import { HomeFooter } from "./footer";

export function MarketingShell({ children, currentPage, contentId = `${currentPage ?? "pricing"}-content`, language = "en" }: { children: ReactNode; currentPage?: "pricing" | "models"; contentId?: string; language?: "en" | "zh-CN" }) {
  const router = useRouter();
  const [destination, setDestination] = useState<HomeDialogDestination>("status");
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const details = destinationDetails[destination];

  function navigate(target: HomeDestination) {
    if (target === "docs" || target === "api-reference") { router.push(target === "docs" ? "/docs" : "/docs#chat-completions"); return; }
    if (target === "sign-in" || target === "get-started") { router.push(target === "sign-in" ? "/login" : "/register"); return; }
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDestination(target); setDialogOpen(true);
  }

  return <div lang={language} className="min-h-dvh">
    <a href={`#${contentId}`} className="skip-link">{language === "zh-CN" ? "跳转到正文" : "Skip to content"}</a>
    <HomeNavbar currentPage={currentPage} />
    {children}
    <HomeFooter onNavigate={navigate} sectionRoot="/" />
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (triggerRef.current?.isConnected && triggerRef.current.getClientRects().length) triggerRef.current.focus();
        else document.getElementById("mobile-menu-button")?.focus();
      }}>
        <DialogHeader><DialogTitle>{details.title}</DialogTitle><DialogDescription className="pt-3 leading-relaxed">{details.description}</DialogDescription></DialogHeader>
        <DialogFooter className="mt-5"><Button variant="secondary" onClick={() => setDialogOpen(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
