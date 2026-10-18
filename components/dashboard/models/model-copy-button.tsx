"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ModelCopyButton({ id, name, showId = true, className }: { id: string; name: string; showId?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  async function copyModelId() {
    if (pending.current) return;
    pending.current = true;
    setAnnouncement("");
    try {
      await navigator.clipboard.writeText(id);
      if (!mounted.current) return;
      setCopied(true);
      setCopyError(false);
      setAnnouncement(`${name} model ID copied.`);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (!mounted.current) return;
      setCopied(false);
      setCopyError(true);
      setAnnouncement(`Could not copy ${name} model ID. Select the model ID and copy it manually.`);
    } finally {
      pending.current = false;
    }
  }

  return (
    <>
      {showId && <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground"><span className="sr-only">Model ID: </span><code className="font-mono break-all select-all">{id}</code></p>}
      <Button type="button" variant="secondary" aria-label={`Copy Model ID for ${name}`} onClick={copyModelId} className={cn("w-full bg-secondary/65 text-xs font-medium text-foreground duration-200 hover:bg-secondary", className)}>
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
        <span>{copied ? "Copied" : "Copy Model ID"}</span>
      </Button>
      {copyError && <p className="mt-2.5 basis-full text-xs leading-relaxed text-muted-foreground">Select the model ID to copy it manually.</p>}
      <span role="status" className="sr-only">{announcement}</span>
    </>
  );
}
