"use client";

import type { RefObject } from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { PublicModel } from "@/lib/model-types";
import { ModelReferenceLoading } from "@/components/models/model-reference-loading";

const ModelReference = dynamic(() => import("@/components/models/model-reference").then(module => module.ModelReference), { loading: ModelReferenceLoading });

export function ConsoleModelDetail({ model, open, onOpenChange, trigger, fallback }: { model: PublicModel | null; open: boolean; onOpenChange: (open: boolean) => void; trigger: RefObject<HTMLButtonElement | null>; fallback: RefObject<HTMLInputElement | null> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent lang="en" showCloseButton={false} className="dashboard-console console-dialog console-model-detail developer-model-dialog data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100" onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); else fallback.current?.focus(); }}>
    <DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label="Close model details" className="absolute top-3 right-3"><X size={16} aria-hidden="true" /></Button></DialogClose>
    {model && <><DialogHeader className="pr-8"><DialogTitle>{model.name}</DialogTitle><DialogDescription>{model.description || "No description provided."}</DialogDescription></DialogHeader><ModelReference key={model.slug} model={model} /></>}
  </DialogContent></Dialog>;
}
