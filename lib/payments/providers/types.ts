import "server-only";
import type { PaymentOrder } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/lib/payment-types";
import { HttpError } from "@/lib/server/http-error";
import { readLimitedText } from "@/lib/ai/http";

export type ProviderIdentity = { method: PaymentMethod; merchantId: string; appId: string };
export type ProviderReceipt = ProviderIdentity & {
  orderNo: string; amount: string; currency: "CNY";
  status: "PENDING" | "PAID" | "FAILED" | "CLOSED";
  transactionId?: string; paidAt?: Date;
};
const proof = Symbol("verified-payment-provider-response");
const verified = new WeakSet<object>();
export type VerifiedReceipt = ProviderReceipt & { readonly [proof]: true };

// Adapters call this only after signature verification. No HTTP route brands client JSON.
export function verifiedReceipt(receipt: ProviderReceipt): VerifiedReceipt {
  const value = Object.freeze({ ...receipt, [proof]: true as const });
  verified.add(value); return value;
}
export function requireVerifiedReceipt(receipt: VerifiedReceipt) {
  if (!verified.has(receipt)) throw new HttpError(400, "Payment confirmation could not be verified.");
}
export interface PaymentProvider {
  identity: ProviderIdentity;
  create(order: PaymentOrder): Promise<{ codeUrl: string }>;
  query(order: PaymentOrder): Promise<VerifiedReceipt>;
  close(order: PaymentOrder): Promise<void>;
  verifyNotification(request: Request): Promise<VerifiedReceipt>;
}
export class PaymentProviderError extends Error {
  constructor() { super("The payment platform is temporarily unavailable."); }
}

export async function boundedBody(request: Pick<Request, "body" | "headers"> & { signal?: AbortSignal }, limit = 65536, deadline?: AbortSignal) {
  if (!request.body) throw new HttpError(400, "Payment notification is missing.");
  const signal = AbortSignal.any([AbortSignal.timeout(10000), ...(request.signal ? [request.signal] : []), ...(deadline ? [deadline] : [])]);
  try { return await readLimitedText(request, limit, signal); }
  catch (error) {
    if (error instanceof Error && error.message === "body_limit") throw new HttpError(413, "Payment notification is too large.");
    throw new HttpError(400, "Payment notification is invalid or timed out.");
  }
}
