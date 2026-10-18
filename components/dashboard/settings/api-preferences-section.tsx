"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicModel } from "@/lib/model-types";
import { SettingsSection } from "./settings-section";

export function ApiPreferencesSection({ catalog, loadError, apiBaseUrl }: { catalog: PublicModel[]; loadError: boolean; apiBaseUrl: string }) {
  const [model, setModel] = useState(catalog[0]?.slug ?? "");
  const selectedModel = catalog.some((item) => item.slug === model) ? model : catalog[0]?.slug ?? "";
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  async function copyBaseUrl() {
    if (pending.current) return;
    pending.current = true;
    setMessage("");
    try {
      await navigator.clipboard.writeText(apiBaseUrl);
      if (!mounted.current) return;
      setCopied(true); setCopyError(false); setMessage("API base URL copied.");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (!mounted.current) return;
      setCopied(false); setCopyError(true); setMessage("Could not copy. Select the URL and copy it manually.");
    } finally { pending.current = false; }
  }

  return (
    <SettingsSection id="api-preferences" title="API Preferences" description="Choose your default model and API endpoint.">
      <div className="max-w-[520px] space-y-6">
        <div>
          <Label htmlFor="settings-model" className="text-[13px]">Default Model</Label>
          <div className="relative mt-2.5">
            <select id="settings-model" value={selectedModel} disabled={loadError || !catalog.length} onChange={(event) => { setModel(event.target.value); setMessage("Default model updated for this preview."); }} aria-describedby="settings-model-help" className="h-11 w-full min-w-0 appearance-none rounded-sm border border-border bg-card pr-10 pl-3.5 text-sm outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15">
              {!catalog.length && <option value="">{loadError ? "Model catalog unavailable" : "No models available"}</option>}
              {catalog.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          </div>
          <p id="settings-model-help" className="mt-2 text-xs leading-relaxed text-muted-foreground">{loadError ? "The model catalog could not be loaded. Please refresh this page." : "Choose from currently enabled models. This preference is a local preview."}</p>
        </div>
        <div>
          <Label htmlFor="settings-base-url" className="text-[13px]">Default API Base URL</Label>
          <div className="mt-2.5 flex min-w-0 items-center gap-2">
            <Input id="settings-base-url" value={apiBaseUrl} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} className="min-w-0 border-border bg-background/65 font-mono text-xs" />
            <Button type="button" variant="secondary" aria-label="Copy API base URL" onClick={copyBaseUrl} className="shrink-0 px-3 text-xs">{copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}<span>{copied ? "Copied" : "Copy"}</span></Button>
          </div>
          {copyError && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Select the URL above to copy it manually.</p>}
        </div>
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">{message}</p>
      </div>
    </SettingsSection>
  );
}
