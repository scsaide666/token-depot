import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaymentCheckout } from "@/components/dashboard/billing/payment-checkout";
import { getPaymentStatus } from "@/lib/payments/reads";
import { paymentOptions } from "@/lib/payments/providers/config";
import { paymentId } from "@/lib/payment-schemas";
import { requireUser } from "@/lib/server/session";
import { HttpError } from "@/lib/server/http";
export const metadata: Metadata = { title: { absolute: "Payment · Token Depot" } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const parsed = paymentId.safeParse((await params).id);
  if (!parsed.success) notFound();
  let data: Awaited<ReturnType<typeof getPaymentStatus>>;
  try { data = await getPaymentStatus(parsed.data); }
  catch (error) { if (error instanceof HttpError && error.status === 404) notFound(); else throw error; }
  return <PaymentCheckout key={`${data.order.id}:${data.order.status}`} initialData={data} options={paymentOptions()} />;
}
