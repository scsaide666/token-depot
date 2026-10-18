"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Braces, KeyRound, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { destinationDetails, type HomeDestination, type HomeDialogDestination } from "@/lib/home-navigation";
import { ApiPreview } from "./api-preview";
import { HomeNavbar } from "./navbar";
import { ModelsSection } from "./models-section";
import { ProductPreview } from "./product-preview";
import { DeveloperSection } from "./developer-section";
import { PricingSection } from "./pricing-section";
import { FinalCta } from "./final-cta";
import { HomeFooter } from "./footer";
import type { PublicModel } from "@/lib/model-types";
import "./vercel-home.css";

export function HomeTop({ catalog, loadError, apiBaseUrl }: { catalog: PublicModel[]; loadError: boolean; apiBaseUrl: string }) {
  const router = useRouter();
  const [destination, setDestination] = useState<HomeDialogDestination>("status");
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const details = destinationDetails[destination];

  function navigate(target: HomeDestination) {
    if (target === "docs" || target === "api-reference") {
      router.push(target === "docs" ? "/docs" : "/docs#chat-completions");
      return;
    }
    if (target === "sign-in" || target === "get-started") {
      router.push(target === "sign-in" ? "/login" : "/register");
      return;
    }
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDestination(target);
    setDialogOpen(true);
  }

  function restoreFocus() {
    if (triggerRef.current?.isConnected && triggerRef.current.getClientRects().length) triggerRef.current.focus();
    else document.getElementById("mobile-menu-button")?.focus();
  }

  return (
    <div lang="en" className="home-vercel min-h-dvh">
      <a href="#home-content" className="skip-link">Skip to content</a>
      <HomeNavbar loginLabel="Login" />
      <main id="home-content">
        <section aria-labelledby="home-heading" className="v-hero v-frame">
          <div className="v-hero-layout">
          <div className="v-hero-intro">
            <p className="v-eyebrow v-enter"><BrandMark size={24} priority /> Build with Token Depot.</p>
            <h1 id="home-heading" className="v-hero-title v-enter">
              <span>One API.</span>
              <span>Every AI model.</span>
            </h1>
            <p className="v-hero-description v-enter">
              Your models, keys, and tokens. Together in Token Depot — the workspace for your next AI-powered build.
            </p>
            <div className="v-actions v-enter">
              <Button asChild><Link href="/register">Get Started <ArrowRight size={15} aria-hidden="true" /></Link></Button>
              <Button variant="outline" asChild><Link href="/docs">Documentation <ArrowUpRight size={15} aria-hidden="true" /></Link></Button>
            </div>
            <p className="v-hero-caption">Your existing SDK. One new base URL.</p>
          </div>
          <ApiPreview model={catalog[0]?.slug} apiBaseUrl={apiBaseUrl} />
          </div>
          <div className="v-hero-notes">
            <span><Braces size={16} aria-hidden="true" />OpenAI-compatible API</span>
            <span><ReceiptText size={16} aria-hidden="true" />Pay for the tokens you use</span>
            <span><KeyRound size={16} aria-hidden="true" />One key for your models</span>
          </div>
        </section>
        <ProductPreview catalog={catalog} loadError={loadError} />
        <ModelsSection catalog={catalog} loadError={loadError} />
        <DeveloperSection apiBaseUrl={apiBaseUrl} />
        <PricingSection catalog={catalog} loadError={loadError} />
        <FinalCta />
      </main>
      <HomeFooter onNavigate={navigate} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="v-home-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
          <DialogHeader>
            <DialogTitle>{details.title}</DialogTitle>
            <DialogDescription className="pt-3 leading-relaxed">{details.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-5">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>Back to home</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
