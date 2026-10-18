import "server-only";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { Prisma, type PaymentOrder } from "@/generated/prisma/client";
import { money } from "@/lib/billing/money";
import { createPaymentBody, type CreatePaymentInput } from "@/lib/payment-schemas";
import { getDb } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http-error";
import { getPaymentProvider } from "./providers";
import { requireVerifiedReceipt, type PaymentProvider, type VerifiedReceipt } from "./providers/types";

const options = { maxWait: 30000, timeout: 15000 };
type Tx = Prisma.TransactionClient;
async function lockWallet(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(503, "Your wallet is temporarily unavailable.");
  return tx.wallet.findFirstOrThrow({ where: { id: rows[0].id, userId } });
}
async function lockOrder(tx: Tx, id: string, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PaymentOrder" WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "Payment order not found.");
  return tx.paymentOrder.findFirstOrThrow({ where: { id, userId } });
}
export async function expireOwnedOrders(userId: string, id?: string) {
  const now = new Date();
  // State bookkeeping only. This never credits or debits the wallet.
  await getDb().paymentOrder.updateMany({ where: { userId, ...(id ? { id } : {}), status: "PENDING", expiresAt: { lte: now } }, data: { status: "CLOSED", closedAt: now } });
}

// Internal service: the HTTP boundary passes a server-derived ACTIVE session identity.
// Optional adapter injection is only for trusted integration tests, never an HTTP parameter.
export async function createPaymentOrder(userId: string, input: CreatePaymentInput, idempotencyKey: string, adapter?: PaymentProvider) {
  const parsed = createPaymentBody.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid payment details.");
  const provider = adapter ?? getPaymentProvider(parsed.data.method), now = new Date();
  if (provider.identity.method !== parsed.data.method) throw new HttpError(400, "Payment method does not match.");
  const amount = money(parsed.data.amount).toFixed(2);
  const result = await getDb().$transaction(async (tx) => {
    await lockWallet(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (user?.status !== "ACTIVE") throw new HttpError(401, "Your session has ended. Sign in again.");
    const existing = await tx.paymentOrder.findFirst({ where: { userId, idempotencyKey } });
    if (existing) {
      if (existing.method !== input.method || !money(existing.amount).eq(amount)) throw new HttpError(409, "This payment attempt already uses different details.");
      if (existing.status !== "PENDING" || existing.expiresAt <= now) throw new HttpError(409, "This payment attempt has ended. Create a new payment.");
      return { order: existing, created: false };
    }
    if (await tx.paymentOrder.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 60000) } } }) >= 10) throw new HttpError(429, "Too many payment attempts. Wait a minute and try again.");
    const order = await tx.paymentOrder.create({ data: {
      userId, orderNo: `AH${randomBytes(14).toString("hex")}`, idempotencyKey, method: input.method, amount,
      merchantId: provider.identity.merchantId, appId: provider.identity.appId, expiresAt: new Date(now.getTime() + 300000),
    } });
    return { order, created: true };
  }, options);
  if (!result.created) return result.order;
  try {
    // No database locks are held across the payment platform call.
    const { codeUrl } = await provider.create(result.order);
    const qrCodeDataUrl = await QRCode.toDataURL(codeUrl, { width: 256, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1D1D1F", light: "#FFFFFF" } });
    await getDb().paymentOrder.updateMany({ where: { id: result.order.id, userId, status: "PENDING", expiresAt: { gt: new Date() } }, data: { codeUrl, qrCodeDataUrl } });
  } catch {
    // An ambiguous network failure never credits money. A later verified notification
    // can still settle the original order; creating another order uses a new attempt ID.
    await getDb().paymentOrder.updateMany({ where: { id: result.order.id, userId, status: "PENDING" }, data: { status: "FAILED" } });
  }
  return getDb().paymentOrder.findFirstOrThrow({ where: { id: result.order.id, userId } });
}

export async function applyVerifiedPayment(receipt: VerifiedReceipt) {
  requireVerifiedReceipt(receipt);
  const hint = await getDb().paymentOrder.findFirst({ where: { orderNo: receipt.orderNo, method: receipt.method }, select: { id: true, userId: true } });
  if (!hint) throw new HttpError(404, "Payment order not found.");
  return getDb().$transaction(async (tx) => {
    // Same wallet-first lock order as token billing, across every app process.
    const wallet = await lockWallet(tx, hint.userId), order = await lockOrder(tx, hint.id, hint.userId);
    if (receipt.merchantId !== order.merchantId || receipt.appId !== order.appId || receipt.currency !== order.currency || !money(receipt.amount).eq(money(order.amount))) throw new HttpError(400, "Payment details do not match the original order.");
    if (order.settledAt) {
      if (receipt.status === "PAID" && receipt.transactionId !== order.providerTransactionId) throw new HttpError(409, "Payment confirmation conflicts with the settled order.");
      return order;
    }
    if (receipt.status !== "PAID") {
      if (order.status === "PENDING" && (receipt.status === "FAILED" || receipt.status === "CLOSED")) return tx.paymentOrder.update({ where: { id: order.id, userId: hint.userId }, data: { status: receipt.status, ...(receipt.status === "CLOSED" ? { closedAt: new Date() } : {}) } });
      return order; // CLOSED / FAILED can never be reset to PENDING.
    }
    if (!receipt.transactionId || !receipt.paidAt || !Number.isFinite(receipt.paidAt.getTime()) || receipt.paidAt.getTime() > Date.now() + 300000) throw new HttpError(400, "Payment confirmation is invalid.");
    // A delayed but verified success may reconcile an expired/failed local display.
    // Only the platform's authenticated success can do this; it never reopens payment.
    const before = money(wallet.balance), credit = money(order.amount), after = before.plus(credit), settledAt = new Date();
    await tx.wallet.update({ where: { id: wallet.id, userId: hint.userId }, data: { balance: after.toFixed(20) } });
    await tx.walletTransaction.create({ data: {
      walletId: wallet.id, paymentOrderId: order.id, type: "RECHARGE", amount: credit.toFixed(20), balanceBefore: before.toFixed(20), balanceAfter: after.toFixed(20),
      description: `${order.method === "ALIPAY" ? "Alipay" : "WeChat Pay"} recharge · ${order.orderNo}`,
    } });
    return tx.paymentOrder.update({ where: { id: order.id, userId: hint.userId }, data: { status: "PAID", paidAt: receipt.paidAt, settledAt, providerTransactionId: receipt.transactionId } });
  }, options);
}

export async function reconcileOwnedPayment(userId: string, id: string, adapter?: PaymentProvider) {
  await expireOwnedOrders(userId, id);
  const order = await getDb().paymentOrder.findFirst({ where: { id, userId } });
  if (!order) throw new HttpError(404, "Payment order not found.");
  if (order.settledAt) return order;
  const provider = adapter ?? getPaymentProvider(order.method);
  if (provider.identity.method !== order.method || provider.identity.appId !== order.appId || provider.identity.merchantId !== order.merchantId) throw new HttpError(503, "This payment cannot be refreshed right now.");
  // Atomic per-order query lease prevents concurrent refresh requests from flooding the platform.
  const lease = await getDb().paymentOrder.updateMany({ where: { id, userId, settledAt: null, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 10000) } }] }, data: { lastCheckedAt: new Date() } });
  if (!lease.count) return order;
  const receipt = await provider.query(order);
  if (receipt.orderNo !== order.orderNo || receipt.method !== order.method) throw new HttpError(400, "Payment confirmation does not match the order.");
  const result = await applyVerifiedPayment(receipt);
  if (receipt.status === "PENDING" && order.expiresAt <= new Date()) {
    try { await provider.close(order); }
    catch {
      // The buyer can pay between query and close. Only a second authenticated
      // query/notification may resolve that race; a close failure never implies PAID.
      const latest = await provider.query(order);
      if (latest.orderNo !== order.orderNo || latest.method !== order.method) throw new HttpError(400, "Payment confirmation does not match the order.");
      return applyVerifiedPayment(latest);
    }
  }
  return result;
}

export type { PaymentOrder };
