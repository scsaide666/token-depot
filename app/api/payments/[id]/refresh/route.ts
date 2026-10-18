import { z } from "zod";
import { paymentId } from "@/lib/payment-schemas";
import { reconcileOwnedPayment } from "@/lib/payments/orders";
import { getPaymentStatus } from "@/lib/payments/reads";
import { HttpError, json, readMutation, requestFailure, requireApiSession } from "@/lib/server/http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireApiSession();
    const id = paymentId.safeParse((await context.params).id), body = z.strictObject({}).safeParse(await readMutation(request));
    if (!id.success || !body.success || new URL(request.url).searchParams.size) throw new HttpError(400, "Invalid payment refresh request.");
    await reconcileOwnedPayment(user.id, id.data);
    return json(await getPaymentStatus(id.data));
  } catch (error) { return requestFailure(error); }
}
