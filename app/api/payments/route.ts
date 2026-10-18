import { createPaymentBody, paymentIdempotencyKey } from "@/lib/payment-schemas";
import { limitSensitiveRequest } from "@/lib/risk/sensitive";
import { createPaymentOrder } from "@/lib/payments/orders";
import { getPaymentStatus, getRechargeHistory } from "@/lib/payments/reads";
import { paymentHistoryQuery, parseAnalyticsQuery } from "@/lib/server/analytics-query";
import { HttpError, json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";

export async function GET(request: Request) {
  try { await requireApiSession(); return json(await getRechargeHistory(parseAnalyticsQuery(new URL(request.url).searchParams, paymentHistoryQuery))); }
  catch (error) { return requestFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { user } = await requireApiSession();
    await limitSensitiveRequest(request, "payment-create", user.id);
    const input = createPaymentBody.safeParse(await readMutation(request)), key = paymentIdempotencyKey.safeParse(request.headers.get("idempotency-key"));
    if (!input.success) throw new HttpError(400, input.error.issues[0]?.message ?? "Invalid payment details.");
    if (!key.success) throw new HttpError(400, "A valid payment attempt ID is required.");
    const order = await createPaymentOrder(user.id, input.data, key.data);
    return json(await getPaymentStatus(order.id), 201);
  } catch (error) { return requestFailure(error); }
}
