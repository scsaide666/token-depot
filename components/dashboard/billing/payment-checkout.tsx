"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPaymentMoney, paymentMethodNames, type PaymentOptions, type PaymentStatusData } from "@/lib/payment-types";
import { usePaymentStatus } from "./use-payment-status";
import { AddBalanceDialog } from "./add-balance-dialog";
import { PaymentStatusBadge } from "./payment-status-badge";

export function PaymentCheckout({ initialData, options }: { initialData: PaymentStatusData; options: PaymentOptions }) {
  const router = useRouter();
  const onPaid = useCallback(() => { window.dispatchEvent(new Event("aihub:payment-confirmed")); router.refresh(); }, [router]);
  const { data, checking, error, stopped, refresh } = usePaymentStatus(initialData, options.methods.some((item) => item.method === initialData.order.method && item.enabled), onPaid);
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((Date.parse(initialData.order.expiresAt) - Date.parse(initialData.serverTime)) / 1000)));
  useEffect(() => {
    if (data.order.status !== "PENDING") return;
    const endsAt = Date.now() + Math.max(0, Date.parse(data.order.expiresAt) - Date.parse(data.serverTime));
    const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [data.serverTime, data.order.expiresAt, data.order.status]);
  const paid = data.order.status === "PAID", expired = ["PENDING", "CLOSED"].includes(data.order.status) && (stopped === "expired" || Date.parse(data.order.expiresAt) <= Date.parse(data.serverTime) || remaining === 0);
  const waiting = data.order.status === "PENDING" && !expired;
  const title = paid ? "Payment successful" : expired ? "Payment expired" : data.order.status === "FAILED" ? "Payment could not be completed" : data.order.status === "CLOSED" ? "Payment closed" : data.order.status === "REFUNDED" ? "Payment refunded" : "Waiting for payment";
  const time = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  return <div className="console-page console-checkout mx-auto max-w-[560px] pb-4">
    <a href="/dashboard/billing" className="text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground">Billing</a>
    <section aria-labelledby="payment-title" className="console-checkout-panel mt-6 border border-border bg-card px-6 py-7 sm:p-8">
      <div className="text-center" aria-live="polite">{paid && <span aria-hidden="true" className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-emerald-700/7 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><Check className="size-6" strokeWidth={1.7} /></span>}
        <h1 id="payment-title" className="ui-page-title">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{paid ? "Your balance has been updated." : waiting ? `Scan with ${paymentMethodNames[data.order.method]} to complete your payment.` : "Create a new payment to add balance."}</p>
      </div>
      {waiting && <div className="mt-7 text-center">{data.qrCodeDataUrl ? <Image src={data.qrCodeDataUrl} alt={`${paymentMethodNames[data.order.method]} payment QR code`} width={256} height={256} unoptimized className="mx-auto h-auto w-[240px] max-w-full rounded-[12px] bg-white" /> : <div role="status" className="mx-auto flex aspect-square w-[240px] max-w-full items-center justify-center rounded-[12px] bg-background text-xs text-muted-foreground">Preparing payment…</div>}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" aria-hidden="true" strokeWidth={1.6} /><span aria-label="Remaining valid time" className="tabular-nums">Valid for {time}</span></p>
      </div>}
      <dl className="mt-8 divide-y divide-border/60 text-[13px]"><div className="flex flex-wrap justify-between gap-3 py-4"><dt className="text-muted-foreground">Recharge amount</dt><dd className="text-xl font-semibold tracking-[-0.025em] tabular-nums">{formatPaymentMoney(data.order.amount, data.order.currency)}</dd></div>
        {paid && <div className="flex flex-wrap justify-between gap-3 py-4"><dt className="text-muted-foreground">Current balance</dt><dd className="text-xl font-semibold tracking-[-0.025em] break-all tabular-nums">{formatPaymentMoney(data.availableBalance, data.order.walletCurrency)}</dd></div>}
        <div className="flex justify-between gap-3 py-4"><dt className="text-muted-foreground">Payment method</dt><dd>{paymentMethodNames[data.order.method]}</dd></div><div className="flex justify-between gap-3 py-4"><dt className="text-muted-foreground">Order</dt><dd className="font-mono text-xs">…{data.order.orderNo.slice(-8)}</dd></div>
        <div className="flex justify-between gap-3 py-4"><dt className="text-muted-foreground">Status</dt><dd><PaymentStatusBadge status={data.order.status} /></dd></div></dl>
      {error && <p role="alert" className="mt-4 text-xs leading-relaxed text-destructive">{error}{error.includes("session") && <a className="ml-2 text-link" href="/login">Sign in</a>}</p>}
      {waiting && stopped === "timeout" && <p role="status" className="mt-4 text-xs leading-relaxed text-muted-foreground">Automatic updates have paused. Refresh status to check again.</p>}
      <div className="mt-7 flex flex-col gap-2">{paid ? <><Button asChild><a href="/dashboard/billing">Back to Billing</a></Button><Button asChild variant="secondary"><a href="/dashboard/billing#transactions">View Transactions</a></Button></> : waiting ? <><Button variant="secondary" loading={checking} disabled={checking} onClick={() => void refresh()}>{checking ? "Checking status…" : "Refresh status"}</Button><Button asChild variant="ghost"><a href="/dashboard/billing">Back to Billing</a></Button></> : <><AddBalanceDialog options={options} label="Create new payment" /><Button variant="ghost" loading={checking} disabled={checking} onClick={() => void refresh()}>{checking ? "Checking status…" : "Refresh status"}</Button><Button asChild variant="secondary"><a href="/dashboard/billing">Back to Billing</a></Button></>}</div>
      {!options.enabled && !paid && <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">Payment methods are currently unavailable.</p>}
    </section>
  </div>;
}
