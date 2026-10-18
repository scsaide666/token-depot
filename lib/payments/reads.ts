import "server-only";
import { Prisma, type PaymentOrder } from "@/generated/prisma/client";
import type { PageQuery } from "@/lib/analytics-types";
import type { PaymentOrderView, PaymentStatusData, RechargeHistoryData, RechargeRecord } from "@/lib/payment-types";
import { money } from "@/lib/billing/money";
import { getDb } from "@/lib/server/db";
import { HttpError, requireApiSession } from "@/lib/server/http";
import { expireOwnedOrders } from "./orders";

export const rechargeSelect = { id: true, orderNo: true, method: true, status: true, amount: true, createdAt: true } satisfies Prisma.PaymentOrderSelect;
export function rechargeDto(row: Prisma.PaymentOrderGetPayload<{ select: typeof rechargeSelect }>): RechargeRecord {
  return { id: row.id, orderNo: row.orderNo, method: row.method, status: row.status, amount: row.amount.toFixed(2), currency: "CNY", createdAt: row.createdAt.toISOString() };
}
function orderDto(row: PaymentOrder): PaymentOrderView {
  return { ...rechargeDto(row), creditAmount: row.amount.toFixed(20), walletCurrency: "CNY", expiresAt: row.expiresAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null };
}
export async function getPaymentStatus(id: string): Promise<PaymentStatusData> {
  const { user } = await requireApiSession();
  await expireOwnedOrders(user.id, id);
  return getDb().$transaction(async (tx) => {
    const order = await tx.paymentOrder.findFirst({ where: { id, userId: user.id } });
    if (!order) throw new HttpError(404, "Payment order not found.");
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: user.id }, select: { balance: true, reservedBalance: true } });
    return { order: orderDto(order), availableBalance: money(wallet.balance).minus(money(wallet.reservedBalance)).toFixed(20), reservedBalance: wallet.reservedBalance.toFixed(20), serverTime: new Date().toISOString(), qrCodeDataUrl: order.status === "PENDING" ? order.qrCodeDataUrl : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 10000 });
}
export async function getRechargeHistory(query: PageQuery): Promise<RechargeHistoryData> {
  const { user } = await requireApiSession();
  await expireOwnedOrders(user.id);
  return getDb().$transaction(async (tx) => {
    const total = await tx.paymentOrder.count({ where: { userId: user.id } });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize)), page = Math.min(query.page, totalPages);
    const rows = await tx.paymentOrder.findMany({ where: { userId: user.id }, select: rechargeSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
    return { recharges: rows.map(rechargeDto), pagination: { total, totalPages, page, pageSize: query.pageSize } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 10000 });
}
