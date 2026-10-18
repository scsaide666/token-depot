"use client";
import { Button } from "@/components/ui/button";

export function ModelCatalogError() {
  return <div role="alert" className="mx-auto mt-6 max-w-[var(--content-public)] rounded-lg border border-border bg-card p-8 text-center"><p className="text-sm font-medium">Unable to load the model catalog.</p><p className="mt-2 text-xs text-muted-foreground">Please try again shortly.</p><Button variant="secondary" className="mt-5" onClick={() => window.location.reload()}>Try again</Button></div>;
}
