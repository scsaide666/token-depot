import { getPaymentProvider } from "@/lib/payments/providers";
import { applyVerifiedPayment } from "@/lib/payments/orders";
import { HttpError } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    await applyVerifiedPayment(await getPaymentProvider("ALIPAY").verifyNotification(request));
    return new Response("success", { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    return new Response("failure", { status: error instanceof HttpError ? error.status : 503, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
}
