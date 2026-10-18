import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { money } from "@/lib/billing/money";
import { adminAdjustmentBody, type AdminAdjustmentInput } from "@/lib/admin-schemas";
import { getDb } from "../db";
import { HttpError, requireAdminApiSession } from "../http";

const options = { maxWait: 30000, timeout: 15000 };
async function lockAdmin(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${id}::uuid AND role = 'ADMIN' AND status = 'ACTIVE' FOR SHARE`;
  if (!rows.length) throw new HttpError(403, "Administrator access is required.");
}
export async function changeUserStatus(userId: string, status: "ACTIVE" | "SUSPENDED") {
  const { user: admin } = await requireAdminApiSession();
  if (admin.id === userId && status === "SUSPENDED") throw new HttpError(409, "You cannot suspend your own administrator account.");
  await getDb().$transaction(async (tx) => {
    await lockAdmin(tx, admin.id);
    const row = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!row) throw new HttpError(404, "User not found.");
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await tx.session.deleteMany({ where: { userId } });
  }, options);
}
export async function adjustUserBalance(userId: string, data: AdminAdjustmentInput) {
  const { user: admin } = await requireAdminApiSession();
  const parsed = adminAdjustmentBody.safeParse(data);
  if (!parsed.success) throw new HttpError(422, "Enter a valid amount and adjustment reason.");
  const amount = money(parsed.data.amount);
  if (!amount.gt(0) || amount.gt("1000000")) throw new HttpError(422, "Use an amount from ¥0.01 to ¥1,000,000.");
  const delta = parsed.data.direction === "DEDUCT" ? amount.negated() : amount;
  return getDb().$transaction(async (tx) => {
    await lockAdmin(tx, admin.id);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, "User wallet not found.");
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: rows[0].id, userId } });
    const existing = await tx.walletTransaction.findUnique({ where: { adminId_adjustmentId: { adminId: admin.id, adjustmentId: parsed.data.adjustmentId } } });
    if (existing) {
      if (existing.walletId !== wallet.id || !money(existing.amount).eq(delta) || existing.reason !== parsed.data.reason) throw new HttpError(409, "This adjustment attempt already has different details.");
      return { id: existing.id, amount: existing.amount.toFixed(20), balanceAfter: existing.balanceAfter.toFixed(20) };
    }
    const before = money(wallet.balance), after = before.plus(delta);
    if (after.lt(money(wallet.reservedBalance))) throw new HttpError(409, "The deduction cannot exceed available balance or consume reserved funds.");
    await tx.wallet.update({ where: { id: wallet.id, userId }, data: { balance: after.toFixed(20) } });
    const entry = await tx.walletTransaction.create({ data: { walletId: wallet.id, type: "ADMIN_ADJUSTMENT", adminId: admin.id, adjustmentId: parsed.data.adjustmentId, reason: parsed.data.reason,
      amount: delta.toFixed(20), balanceBefore: before.toFixed(20), balanceAfter: after.toFixed(20), description: "Administrator balance adjustment" } });
    return { id: entry.id, amount: entry.amount.toFixed(20), balanceAfter: entry.balanceAfter.toFixed(20) };
  }, options);
}
