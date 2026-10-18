"use client";

import type { RefObject } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { PublicModel } from "@/lib/model-types";
import { ModelReferenceLoading } from "./model-reference-loading";

const ModelReference = dynamic(() => import("./model-reference").then(module => module.ModelReference), { loading: ModelReferenceLoading });

export function ModelDetail({ model, open, onOpenChange, returnFocusRef, fallbackFocusRef }: { model: PublicModel | null; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef: RefObject<HTMLButtonElement | null>; fallbackFocusRef: RefObject<HTMLInputElement | null> }) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent lang="en" className="model-detail-sheet developer-model-sheet right-0 left-auto w-full max-w-full rounded-none border-r-0 border-l border-border sm:w-[640px] sm:max-w-[calc(100%-48px)]" onCloseAutoFocus={event => {
      event.preventDefault();
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      else fallbackFocusRef.current?.focus({ preventScroll: true });
    }}>
      {model && <><div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-card py-3 pr-3 pl-5 sm:pl-7"><span className="text-xs text-muted-foreground">Model reference</span><SheetClose aria-label="Close model details" className="dashboard-icon-button"><X size={18} aria-hidden="true" /></SheetClose></div>
        <div className="min-w-0 px-5 pt-6 pb-8 sm:px-7"><SheetTitle className="text-[28px] leading-tight font-semibold tracking-[-0.04em] [overflow-wrap:anywhere] sm:text-[32px]">{model.name}</SheetTitle><SheetDescription className="mt-3 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{model.description || "No description provided."}</SheetDescription><ModelReference key={model.slug} model={model} /></div>
      </>}
    </SheetContent>
  </Sheet>;
}
