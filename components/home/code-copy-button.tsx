"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function CodeCopyButton({ code, label = "Copy code", successMessage = "Code example copied.", showLabel = false, dark = false }: {
  code: string;
  label?: string;
  successMessage?: string;
  showLabel?: boolean;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [copying, setCopying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false), mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  async function copyCode() {
    if (pending.current) return;
    pending.current = true;
    setCopying(true);
    setMessage("");
    try {
      await navigator.clipboard.writeText(code);
      if (!mounted.current) return;
      setCopied(true);
      setCopyFailed(false);
      setMessage(successMessage);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (!mounted.current) return;
      setCopied(false);
      setCopyFailed(true);
      setMessage("Could not access the clipboard. Select the example to copy it manually.");
    } finally { pending.current = false; if (mounted.current) setCopying(false); }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={copyFailed ? `${label}. Copy failed; select the text to copy manually.` : copied ? `${label} again` : label}
            aria-busy={copying || undefined}
            disabled={copying}
            onClick={copyCode}
            className={cn(
              "ui-pressable ui-code-copy flex shrink-0 items-center justify-center text-xs disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              showLabel ? "h-9 min-w-[78px] gap-2 rounded-sm px-2.5" : "size-8 rounded-lg",
              dark ? "text-[var(--code-muted)] hover:bg-[var(--code-secondary)] hover:text-[var(--code-foreground)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {showLabel && <span>{copying ? "Copying" : copyFailed ? "Retry copy" : copied ? "Copied" : "Copy"}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copyFailed ? message : copied ? "Copied" : label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </>
  );
}
