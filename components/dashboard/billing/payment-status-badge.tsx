import { Badge } from "@/components/ui/badge";
import { paymentStatusNames, type PaymentStatus } from "@/lib/payment-types";
const styles: Record<PaymentStatus, string> = {
  PENDING: "bg-secondary text-muted-foreground",
  PAID: "bg-emerald-700/7 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
  FAILED: "bg-destructive/7 text-destructive",
  CLOSED: "bg-secondary text-muted-foreground",
  REFUNDED: "bg-secondary text-muted-foreground",
};
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant="secondary" data-api-status={status} className={`${styles[status]} px-2.5 py-1 text-[11px] font-normal`}>{paymentStatusNames[status]}</Badge>;
}
