"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCaption, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AdminPageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div className="min-w-0"><h1 className="ui-page-title">{title}</h1><p className="ui-page-description">{description}</p></div>{action}</div>;
}

export function AdminStatus({ status }: { status: string }) {
  const labels: Record<string, string> = { ACTIVE: "Active", SUSPENDED: "Suspended", PENDING: "Pending", SUCCESS: "Success", FAILED: "Failed", PAID: "Paid", CLOSED: "Closed", REFUNDED: "Refunded" };
  status = labels[status] ?? status;
  const danger = status === "Failed" || status === "Suspended";
  const weak = status === "Disabled" || status === "Pending" || status === "Refunded";
  return <Badge variant="secondary" className={`rounded-[var(--radius-badge)] px-2 py-0.5 text-xs font-normal ${danger ? "bg-destructive/7 text-destructive" : weak ? "bg-background text-muted-foreground" : "bg-secondary/70 text-foreground/80"}`}>{status}</Badge>;
}

export function AdminDataTable({ label, columns, minWidth = 700, children, demo = false }: { label: string; columns: { label: string; numeric?: boolean }[]; minWidth?: number; children: ReactNode; demo?: boolean }) {
  return <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"><Table className="admin-table" style={{ minWidth }} containerProps={{ role: "region", tabIndex: 0, "aria-label": `${label}, scroll horizontally for all columns`, className: "admin-table-scroll outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" }}><TableCaption className="sr-only">{label}.{demo ? " Demo data." : ""}</TableCaption><TableHeader className="bg-background/45"><TableRow className="hover:bg-transparent">{columns.map((column) => <TableHead key={column.label} scope="col" className={column.numeric ? "text-right" : ""}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></Table></div>;
}

export function AdminEmpty({ onReset, columns }: { onReset: () => void; columns: number }) {
  return <TableRow className="hover:bg-transparent"><td colSpan={columns} className="px-6 py-14 text-center"><p className="text-sm font-medium">No matching records</p><p className="mt-2 text-xs text-muted-foreground">Try a different search or filter.</p><Button variant="secondary" size="sm" onClick={onReset} className="mt-5 text-xs">Reset filters</Button></td></TableRow>;
}

export function AdminSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="flex min-w-0 flex-col gap-2"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-0 rounded-sm border border-input bg-card pr-3 pl-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:min-w-[170px] sm:text-[13px]">{options.map((option) => <option key={option} value={option}>{option === "All" ? `All ${label.toLowerCase() === "status" ? "statuses" : `${label.toLowerCase()}s`}` : option}</option>)}</select></label>;
}

export function AdminSearch({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return <div className="relative min-w-0 flex-1 sm:max-w-[360px]"><Search className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" /><Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className="pricing-search rounded-sm pl-10 sm:text-[13px]" /></div>;
}

export function AdminModal({ open, onOpenChange, title, description, returnFocusRef, focusId, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; returnFocusRef: RefObject<HTMLElement | null>; focusId?: string; children: ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent lang="en" showCloseButton={false} className="rounded-xl" onOpenAutoFocus={(event) => { if (focusId) { event.preventDefault(); document.getElementById(focusId)?.focus(); } }} onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }); else document.getElementById("admin-content")?.focus({ preventScroll: true }); }}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="pt-1 leading-relaxed">{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}

export function AdminActionMenu<T extends string>({ name, items, onAction }: { name: string; items: { id: T; label: string; destructive?: boolean; separator?: boolean }[]; onAction: (action: T, trigger: HTMLButtonElement | null) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<T | null>(null);
  return <DropdownMenu><DropdownMenuTrigger asChild><Button ref={triggerRef} variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} className="text-muted-foreground"><MoreHorizontal className="size-[17px]" aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (pending.current) { event.preventDefault(); const action = pending.current; pending.current = null; onAction(action, triggerRef.current); } }}>{items.map((item) => <div key={item.id}>{item.separator && <DropdownMenuSeparator />}<DropdownMenuItem destructive={item.destructive} onSelect={() => { pending.current = item.id; }}>{item.label}</DropdownMenuItem></div>)}</DropdownMenuContent></DropdownMenu>;
}
