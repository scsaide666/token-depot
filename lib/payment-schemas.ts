import { z } from "zod";
const amountPattern = /^(0|[1-9]\d{0,4})(\.\d{1,2})?$/;

export const createPaymentBody = z.strictObject({
  method: z.enum(["ALIPAY", "WECHAT"]),
  amount: z.string().regex(amountPattern, "Enter a CNY amount with up to two decimal places.")
    .refine((value) => { if (!amountPattern.test(value)) return false; const [whole, fraction = ""] = value.split("."); const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")); return cents >= BigInt(100) && cents <= BigInt(1000000); }, "Use an amount between ¥1 and ¥10,000."),
});
export const paymentId = z.uuid();
export const paymentIdempotencyKey = z.uuid();
export type CreatePaymentInput = z.infer<typeof createPaymentBody>;
