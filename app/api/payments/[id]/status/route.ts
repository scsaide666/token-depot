import { paymentId } from "@/lib/payment-schemas";
import { getPaymentStatus } from "@/lib/payments/reads";
import { HttpError, json, requestFailure, requireApiSession } from "@/lib/server/http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const parsed = paymentId.safeParse((await context.params).id);
    if (!parsed.success || new URL(request.url).searchParams.size) throw new HttpError(400, "Invalid payment order query.");
    return json(await getPaymentStatus(parsed.data));
  } catch (error) { return requestFailure(error); }
}
