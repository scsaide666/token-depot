"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Toast as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Feedback({ message, error = false, className }: { message: string; error?: boolean; className?: string }) {
  const [dismissed, setDismissed] = useState("");
  return <div hidden={!message || dismissed === message} inert={!message || dismissed === message} className={cn("ui-disclosure ui-feedback", className)} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
    {error ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}<span>{message}</span><button type="button" className="ui-pressable" aria-label="Dismiss feedback" onClick={() => setDismissed(message)}><X size={14} aria-hidden="true" /></button>
  </div>;
}

type Notice = { message: string; error: boolean };
export function ToastNotice({ notice, onDismiss, className }: { notice: Notice | null; onDismiss: () => void; className?: string }) {
  // Preserve the displayed text through Radix's exit lifecycle.
  const [display, setDisplay] = useState({ notice, revision: 0 });
  if (notice && notice !== display.notice) setDisplay({ notice, revision: display.revision + 1 });
  const lastNotice = display.notice;
  // The parent owns expiry and restarts it for each action. A second Radix timer
  // would close a repeated notification using the previous action's deadline.
  // A fresh Root makes Radix announce every result, including repeated messages.
  // Closing preserves the revision and message so the exit animation can finish.
  return <Primitive.Provider duration={Infinity} label="Notifications"><Primitive.Root key={display.revision} open={!!notice} onOpenChange={open => { if (!open) onDismiss(); }} type={lastNotice?.error ? "foreground" : "background"} className={cn("ui-toast", className)}>
    {lastNotice?.error ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}<Primitive.Title className="min-w-0 flex-1">{lastNotice?.message}</Primitive.Title><Primitive.Close className="ui-pressable" aria-label="Dismiss notification"><X size={14} aria-hidden="true" /></Primitive.Close>
  </Primitive.Root><Primitive.Viewport className="ui-toast-viewport" /></Primitive.Provider>;
}
