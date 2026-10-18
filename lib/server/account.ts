import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AccountUser } from "@/lib/account-types";
import { money } from "@/lib/billing/money";

export const accountSelect = {
  id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true,
  wallet: { select: { balance: true, reservedBalance: true } },
} satisfies Prisma.UserSelect;
type AccountRecord = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

export function accountDto(user: AccountRecord): AccountUser {
  if (!user.wallet) throw new Error("User wallet is missing.");
  // All money formatting and storage use Decimal; no floating-point arithmetic.
  const formatted = money(user.wallet.balance).minus(money(user.wallet.reservedBalance)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return {
    id: user.id, name: user.name, email: user.email, role: user.role, status: user.status,
    createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(),
    wallet: { balance: user.wallet.balance.toFixed(20), reservedBalance: user.wallet.reservedBalance.toFixed(20), balanceDisplay: `¥${formatted}` },
  };
}
