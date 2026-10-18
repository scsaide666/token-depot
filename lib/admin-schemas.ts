import { z } from "zod";

export const adminUserId = z.uuid();
export const adminStatusBody = z.strictObject({ status: z.enum(["ACTIVE", "SUSPENDED"]) });
export const adminAdjustmentBody = z.strictObject({
  direction: z.enum(["ADD", "DEDUCT"]),
  amount: z.string().trim().regex(/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/, "Use a positive CNY amount with up to two decimal places."),
  reason: z.string().trim().min(3, "Enter a reason with at least 3 characters.").max(200),
  adjustmentId: z.uuid(),
});
export type AdminAdjustmentInput = z.infer<typeof adminAdjustmentBody>;
