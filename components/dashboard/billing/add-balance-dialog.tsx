"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RadioGroup } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createPaymentBody } from "@/lib/payment-schemas";
import { paymentMethodNames, type PaymentMethod, type PaymentOptions, type PaymentStatusData } from "@/lib/payment-types";

const amounts = ["5", "10", "20", "50", "100"];
export function AddBalanceDialog({ options, label = "Add Balance" }: { options: PaymentOptions; label?: string }) {
  const router = useRouter(), id = useId();
  const [open, setOpen] = useState(false), [amount, setAmount] = useState("50");
  const [method, setMethod] = useState<PaymentMethod>(options.methods.find((item) => item.enabled)?.method ?? "ALIPAY");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const attempt = useRef<string | null>(null), active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  function changeAmount(value: string) { setAmount(value); setError(""); attempt.current = null; }
  function changeOpen(value: boolean) {
    if (value) { setAmount("50"); setError(""); attempt.current = null; }
    else { active.current?.abort(); setLoading(false); }
    setOpen(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const result = createPaymentBody.safeParse({ amount, method });
    if (!result.success) { setError(result.error.issues[0].message); return; }
    const controller = new AbortController(); active.current = controller;
    attempt.current ??= crypto.randomUUID(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current }, body: JSON.stringify(result.data), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const body = await response.json() as PaymentStatusData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "We couldn’t create this payment. Please try again.");
      if (!controller.signal.aborted) { setOpen(false); router.push(`/dashboard/billing/payments/${encodeURIComponent(body.order.id)}`); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error && !["TypeError", "TimeoutError", "AbortError"].includes(failure.name) ? failure.message : "We couldn’t connect. Please try again."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button disabled={!options.enabled} className="w-full sm:w-auto">{label}</Button></DialogTrigger>
    <DialogContent lang="en" showCloseButton={false} className="dashboard-console console-dialog console-recharge-dialog data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 sm:max-w-[480px]">
      <DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Close Add Balance" className="absolute top-4 right-4 text-muted-foreground"><X className="size-[18px]" aria-hidden="true" strokeWidth={1.6} /></Button></DialogClose>
      <DialogHeader className="pr-7"><DialogTitle>Add Balance</DialogTitle><DialogDescription className="pt-1 leading-relaxed">Choose a payment method and an amount in CNY.</DialogDescription></DialogHeader>
      <form onSubmit={submit} noValidate className="mt-2 space-y-6">
        <fieldset disabled={loading}><legend className="mb-2.5 text-[13px]">Payment method</legend><RadioGroup.Root value={method} onValueChange={(value) => { setMethod(value as PaymentMethod); attempt.current = null; setError(""); }} className="grid grid-cols-2 gap-2">{options.methods.map((item) => <RadioGroup.Item key={item.method} value={item.method} disabled={!item.enabled || loading} className="h-11 rounded-[10px] border border-border bg-card px-3 text-sm outline-none transition-colors duration-200 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-primary/40 data-[state=checked]:bg-primary/7 data-[state=checked]:text-link">{paymentMethodNames[item.method]}</RadioGroup.Item>)}</RadioGroup.Root></fieldset>
        <div><Label htmlFor={id} className="text-[13px] font-normal">Amount</Label><div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-5">{amounts.map((value) => <Button type="button" key={value} variant="outline" disabled={loading} aria-pressed={amount === value} onClick={() => changeAmount(value)} className={`h-10 px-1 font-normal tabular-nums ${amount === value ? "border-primary/40 bg-primary/7 text-link" : ""}`}>¥{value}</Button>)}</div><div className="relative mt-3"><span aria-hidden="true" className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">¥</span><Input id={id} inputMode="decimal" autoComplete="off" disabled={loading} value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="50.00" maxLength={8} className="pl-8 text-sm" aria-invalid={!!error} aria-describedby={`${id}-hint`} /></div><p id={`${id}-hint`} className="mt-2 text-xs text-muted-foreground">Custom amount · ¥1–¥10,000</p></div>
        {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
        <Button type="submit" loading={loading} disabled={loading || !options.enabled} className="w-full">{loading ? "Creating payment…" : "Continue to Payment"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
