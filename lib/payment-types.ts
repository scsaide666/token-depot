import type { PageInfo } from "./analytics-types";

export type PaymentMethod = "ALIPAY" | "WECHAT";
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "CLOSED" | "REFUNDED";
export type PaymentCurrency = "CNY";
export const paymentMethodNames = { ALIPAY: "Alipay", WECHAT: "WeChat Pay" } as const;
export const paymentStatusNames = { PENDING: "Pending", PAID: "Paid", FAILED: "Failed", CLOSED: "Closed", REFUNDED: "Refunded" } as const;
export const isPaymentTerminal = (status: PaymentStatus) => status !== "PENDING";

// Public projections only. Provider credentials, signed payloads and buyer data stay server-side.
export type RechargeRecord = {
  id: string; orderNo: string; method: PaymentMethod; status: PaymentStatus;
  amount: string; currency: PaymentCurrency; createdAt: string;
};
export type PaymentOrderView = RechargeRecord & {
  creditAmount: string; walletCurrency: PaymentCurrency; expiresAt: string; paidAt: string | null;
};
export type PaymentStatusData = {
  order: PaymentOrderView; availableBalance: string; reservedBalance: string; serverTime: string;
  qrCodeDataUrl: string | null;
};
export type PaymentCheckoutData = PaymentStatusData;
export type RechargeHistoryData = { recharges: RechargeRecord[]; pagination: PageInfo };
export type PaymentOptions = { methods: { method: PaymentMethod; enabled: boolean }[]; enabled: boolean };

export function formatPaymentMoney(value: string, currency: PaymentCurrency) {
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${currency === "CNY" ? "¥" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimals}`;
}
