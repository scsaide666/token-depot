import { dashboardBalance } from "./dashboard-demo-data";

export const billingSummary = {
  balance: dashboardBalance,
  monthSpend: "¥18.42",
  lifetimeSpend: "¥57.15",
  totalTokens: "26.8M",
} as const;

export const topUpPresets = [5, 10, 20, 50, 100] as const;
export type TransactionStatus = "Completed" | "Pending" | "Failed" | "Refunded";
export type BillingTransaction = {
  id: string;
  date: string;
  type: "Top up" | "API Usage" | "Refund";
  amountCents: number;
  status: TransactionStatus;
  description: string;
};

export const billingTransactions: BillingTransaction[] = [
  { id: "txn-01", date: "Oct 5, 2026", type: "Top up", amountCents: 2000, status: "Completed", description: "Balance recharge" },
  { id: "txn-02", date: "Oct 5, 2026", type: "API Usage", amountCents: -18, status: "Completed", description: "GPT-5 usage" },
  { id: "txn-03", date: "Oct 4, 2026", type: "Top up", amountCents: 1000, status: "Pending", description: "Balance recharge" },
  { id: "txn-04", date: "Oct 4, 2026", type: "Top up", amountCents: 500, status: "Failed", description: "Balance recharge" },
  { id: "txn-05", date: "Oct 3, 2026", type: "Refund", amountCents: -500, status: "Refunded", description: "Balance recharge refund" },
  { id: "txn-06", date: "Oct 3, 2026", type: "API Usage", amountCents: -124, status: "Completed", description: "Claude Sonnet usage" },
  { id: "txn-07", date: "Oct 1, 2026", type: "Top up", amountCents: 5000, status: "Completed", description: "Balance recharge" },
  { id: "txn-08", date: "Sep 30, 2026", type: "API Usage", amountCents: -48, status: "Completed", description: "Gemini usage" },
];

export function formatBillingAmount(cents: number, signed = false) {
  const value = new Intl.NumberFormat("en-US", { style: "currency", currency: "CNY" }).format(Math.abs(cents) / 100);
  return `${cents < 0 ? "-" : signed && cents > 0 ? "+" : ""}${value}`;
}

export function validateCustomAmount(value: string): { cents: number | null; error: string } {
  const amount = value.trim();
  if (!amount) return { cents: null, error: "Enter a custom amount." };
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(amount)) return { cents: null, error: "Enter a CNY amount with up to two decimal places." };
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents)) return { cents: null, error: "Enter a smaller amount." };
  if (cents <= 0) return { cents: null, error: "Enter an amount greater than ¥0." };
  return { cents, error: "" };
}
