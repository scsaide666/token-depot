import { getPaymentProvider } from "@/lib/payments/providers";
import { applyVerifiedPayment } from "@/lib/payments/orders";
import { HttpError, json } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    await applyVerifiedPayment(await getPaymentProvider("WECHAT").verifyNotification(request));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return json({ code: "FAIL", message: "Payment notification was not accepted." }, error instanceof HttpError ? error.status : 503); }
}
