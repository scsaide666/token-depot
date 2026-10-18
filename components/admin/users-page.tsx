"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { SegmentedControl } from "@/components/dashboard/usage/segmented-control";
import { useAnalytics } from "@/components/dashboard/analytics/use-analytics";
import { DataError } from "@/components/dashboard/analytics/data-states";
import { DataPagination } from "@/components/dashboard/analytics/pagination";
import type { AdminUsersData, AdminUserQuery, AdminUserRecord } from "@/lib/admin-types";
import { adminAdjustmentBody } from "@/lib/admin-schemas";
import { adminRequest } from "@/lib/admin-client";
import { formatCny, formatCount, requestDate } from "@/lib/analytics-format";
import { AdminActionMenu, AdminDataTable, AdminEmpty, AdminModal, AdminPageHeading, AdminSearch, AdminStatus } from "./admin-ui";
import { AdminFilters, AdminFilterSelect, AdminLoading } from "./data-ui";

type UserAction = "view" | "suspend" | "unsuspend" | "adjust";
const columns = [{ label: "Name" }, { label: "Email" }, { label: "Balance", numeric: true }, { label: "Lifetime Spend", numeric: true }, { label: "Requests", numeric: true }, { label: "Status" }, { label: "Created" }, { label: "Actions", numeric: true }];

export function AdminUsersPage({ initialData }: { initialData: AdminUsersData }) {
  const { data, query, loading, error: loadError, load, retry } = useAnalytics(initialData, initialData.query, "/api/admin/users");
  const [search, setSearch] = useState(query.search ?? ""), [status, setStatus] = useState<string>(query.status ?? "");
  const [selected, setSelected] = useState<AdminUserRecord>(), [action, setAction] = useState<UserAction>("view"), [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"ADD" | "DEDUCT">("ADD"), [amount, setAmount] = useState(""), [reason, setReason] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const adjustmentId = useRef(""), selectionVersion = useRef(0), returnFocusRef = useRef<HTMLElement | null>(null);
  function apply() { void load({ page: 1, pageSize: query.pageSize, search: search.trim() || undefined, status: status as AdminUserQuery["status"] || undefined }); }
  function reset() { setSearch(""); setStatus(""); void load({ page: 1, pageSize: query.pageSize }); }
  function close(value: boolean) { if (!pending) setOpen(value); }
  async function openAction(next: UserAction, user: AdminUserRecord, trigger: HTMLButtonElement | null) {
    returnFocusRef.current = trigger; setSelected(user); setAction(next); setAmount(""); setReason(""); setDirection("ADD"); setError(""); setNotice(""); setOpen(true);
    adjustmentId.current = crypto.randomUUID();
    const version = ++selectionVersion.current;
    setPending(true);
    try { const result = await adminRequest<{ user: AdminUserRecord }>(`/api/admin/users/${user.id}`); if (version === selectionVersion.current) setSelected(result.user); }
    catch (failure) { if (version === selectionVersion.current) setError(failure instanceof Error ? failure.message : "Unable to load user."); }
    finally { if (version === selectionVersion.current) setPending(false); }
  }
  async function changeStatus() {
    if (!selected || pending) return; setPending(true); setError("");
    try {
      const result = await adminRequest<{ user: AdminUserRecord }>(`/api/admin/users/${selected.id}`, "PATCH", { status: action === "suspend" ? "SUSPENDED" : "ACTIVE" });
      setSelected(result.user); setOpen(false); setNotice(`${selected.name} is now ${action === "suspend" ? "suspended" : "active"}.`); await load(query);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update account status."); }
    finally { setPending(false); }
  }
  async function adjustBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || pending) return;
    const parsed = adminAdjustmentBody.safeParse({ direction, amount: amount.trim(), reason, adjustmentId: adjustmentId.current });
    if (!parsed.success) { setError("Enter a positive amount with up to two decimal places and a reason (3–200 characters)."); return; }
    setPending(true); setError("");
    try {
      const result = await adminRequest<{ transaction: { balanceAfter: string } }>(`/api/admin/users/${selected.id}/balance`, "POST", parsed.data);
      setOpen(false); setNotice(`Balance for ${selected.name} updated to ${formatCny(result.transaction.balanceAfter)}. An audit entry was recorded.`); await load(query);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to adjust this balance."); }
    finally { setPending(false); }
  }
  const description = action === "view" ? "Current account information from the database." : action === "adjust" ? "Every adjustment records your administrator ID, reason and amount in the wallet ledger." : action === "suspend" ? "Suspend API access and end this user’s active sessions." : "Restore account access. The user will need to sign in again.";
  return <div className="space-y-6">
    <AdminPageHeading title="Users" description="Manage accounts, balances and account status." />
    <AdminFilters onApply={apply} onReset={reset} loading={loading}>
      <AdminSearch label="Search users" placeholder="Search name or email" value={search} onChange={setSearch} />
      <AdminFilterSelect label="Status" value={status} onChange={setStatus} options={[["", "All statuses"], ["ACTIVE", "Active"], ["SUSPENDED", "Suspended"]]} />
    </AdminFilters>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p aria-live="polite">{formatCount(data.pagination.total)} users</p><span>Balances and lifetime API spend in CNY</span></div>
    {loading ? <AdminLoading /> : loadError ? <DataError message={loadError} onRetry={retry} /> : <>
      <AdminDataTable label="Users" columns={columns} minWidth={1140}>
        {!data.users.length ? <AdminEmpty columns={8} onReset={reset} /> : data.users.map((user) => <TableRow key={user.id}>
          <TableCell><span className="font-medium">{user.name}</span></TableCell><TableCell className="text-muted-foreground">{user.email}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCny(user.balance)}</TableCell><TableCell className="text-right text-muted-foreground tabular-nums">{formatCny(user.lifetimeSpend)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCount(user.requests)}</TableCell><TableCell><AdminStatus status={user.status} /></TableCell><TableCell className="text-muted-foreground">{requestDate(user.createdAt)}</TableCell>
          <TableCell className="text-right"><AdminActionMenu<UserAction> name={user.name} items={[{ id: "view", label: "View" }, { id: "adjust", label: "Adjust Balance" }, { id: user.status === "ACTIVE" ? "suspend" : "unsuspend", label: user.status === "ACTIVE" ? "Suspend" : "Unsuspend", destructive: user.status === "ACTIVE", separator: true }]} onAction={(next, trigger) => void openAction(next, user, trigger)} /></TableCell>
        </TableRow>)}
      </AdminDataTable>
      <DataPagination pagination={data.pagination} label="Users" onChange={(page) => void load({ ...query, page })} />
    </>}
    <p role="status" className="min-h-4 text-xs text-muted-foreground">{notice}</p>
    <AdminModal open={open} onOpenChange={close} returnFocusRef={returnFocusRef} focusId={action === "adjust" ? "admin-adjust-amount" : "admin-user-dismiss"} title={action === "view" ? "User details" : action === "adjust" ? "Adjust balance" : action === "suspend" ? "Suspend user?" : "Unsuspend user?"} description={description}>
      {selected && <div aria-busy={pending}>
        {action === "view" ? <>
          {pending && <p role="status" className="text-xs text-muted-foreground">Refreshing user details…</p>}
          <dl className="divide-y divide-border/60 text-sm">{[["Name", selected.name], ["Email", selected.email], ["User ID", selected.id], ["Balance", formatCny(selected.balance)], ["Reserved balance", formatCny(selected.reservedBalance)], ["Available balance", formatCny(selected.availableBalance)], ["Lifetime spend", formatCny(selected.lifetimeSpend)], ["Requests", formatCount(selected.requests)], ["Status", selected.status === "ACTIVE" ? "Active" : "Suspended"], ["Created (UTC)", requestDate(selected.createdAt)]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-full break-all text-right">{value}</dd></div>)}</dl>
          {error && <p role="alert" className="mb-4 text-xs text-destructive">{error}</p>}
          <div className="my-4 flex flex-wrap gap-5 text-xs"><Link className="auth-link" href={`/admin/requests?userId=${selected.id}`}>View requests</Link><Link className="auth-link" href={`/admin/payments?userId=${selected.id}`}>View payments</Link></div>
          <DialogFooter><Button id="admin-user-dismiss" variant="secondary" disabled={pending} onClick={() => close(false)}>Done</Button></DialogFooter>
        </> : action === "adjust" ? <form onSubmit={adjustBalance} noValidate className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4 text-sm"><span className="text-muted-foreground">{selected.name}</span><span className="font-medium break-all tabular-nums">{formatCny(selected.availableBalance)} available</span></div>
          <SegmentedControl label="Adjustment type" value={direction} options={[{ value: "ADD", label: "Add" }, { value: "DEDUCT", label: "Deduct" }]} onChange={(value) => { if (!pending) { setDirection(value); setError(""); } }} />
          <div className="space-y-2"><label htmlFor="admin-adjust-amount" className="text-xs font-medium">Amount (CNY)</label><Input id="admin-adjust-amount" inputMode="decimal" autoComplete="off" placeholder="10.00" value={amount} maxLength={10} disabled={pending} onChange={(event) => { setAmount(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "admin-adjust-error" : "admin-adjust-hint"} /><p id="admin-adjust-hint" className="text-xs text-muted-foreground">A positive amount with up to two decimal places. Reserved funds cannot be deducted.</p></div>
          <div className="space-y-2"><label htmlFor="admin-adjust-reason" className="text-xs font-medium">Reason</label><Input id="admin-adjust-reason" value={reason} maxLength={200} placeholder="Describe why this adjustment is needed" disabled={pending} onChange={(event) => { setReason(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby="admin-adjust-error" /></div>
          {error && <p id="admin-adjust-error" role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="secondary" disabled={pending} onClick={() => close(false)}>Cancel</Button><Button loading={pending} type="submit" disabled={pending || !amount.trim() || reason.trim().length < 3}>{pending ? "Saving…" : "Apply adjustment"}</Button></DialogFooter>
        </form> : <>
          <div className="mb-5 rounded-md border border-border bg-secondary px-4 py-3"><p className="text-sm font-medium">{selected.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{selected.email}</p></div>
          {error && <p role="alert" className="mb-4 text-xs text-destructive">{error}</p>}
          <DialogFooter><Button id="admin-user-dismiss" variant="secondary" disabled={pending} onClick={() => close(false)}>Cancel</Button><Button loading={pending} variant={action === "suspend" ? "destructive" : "default"} disabled={pending} className={action === "suspend" ? "bg-destructive/8 text-destructive hover:bg-destructive/12" : ""} onClick={changeStatus}>{pending ? "Saving…" : action === "suspend" ? "Suspend user" : "Unsuspend user"}</Button></DialogFooter>
        </>}
      </div>}
    </AdminModal>
  </div>;
}
