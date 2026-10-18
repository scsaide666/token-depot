"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthFieldProps = ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
};

export function AuthField({ id, label, error, hint, type = "text", disabled, ...props }: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const description = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ");

  return (
    <div>
      <Label htmlFor={id} className="mb-2 text-[13px] font-medium">{label}</Label>
      <div className="relative">
        <Input {...props} id={id} type={isPassword && visible ? "text" : type} disabled={disabled}
          aria-invalid={!!error} aria-describedby={description || undefined}
          className={`border-input ${isPassword ? "pr-12" : ""}`} />
        {isPassword && (
          <button type="button" disabled={disabled} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
            aria-pressed={visible} aria-controls={id} onClick={() => setVisible((value) => !value)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring disabled:opacity-40">
            {visible ? <EyeOff className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /> : <Eye className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />}
          </button>
        )}
      </div>
      {hint && <div id={`${id}-hint`} className="mt-2">{hint}</div>}
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{error}</p>}
    </div>
  );
}
