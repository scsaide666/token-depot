"use client";

import { useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ApiKeyRecord } from "@/lib/api-key-types";

export type KeyAction = "rename" | "revoke" | "delete";

export function KeyActions({ record, onCopy, onAction }: {
  record: ApiKeyRecord;
  onCopy: (record: ApiKeyRecord) => void;
  onAction: (action: KeyAction, record: ApiKeyRecord, trigger: HTMLButtonElement | null) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<KeyAction | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" aria-label={`Actions for ${record.name}`} className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="dashboard-console console-menu" align="end" onCloseAutoFocus={(event) => {
        if (pendingAction.current) {
          event.preventDefault();
          const action = pendingAction.current;
          pendingAction.current = null;
          onAction(action, record, triggerRef.current);
        }
      }}>
        <DropdownMenuItem onSelect={() => onCopy(record)}>Copy masked key</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { pendingAction.current = "rename"; }}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={record.status === "revoked"} onSelect={() => { pendingAction.current = "revoke"; }}>Revoke</DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => { pendingAction.current = "delete"; }}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
