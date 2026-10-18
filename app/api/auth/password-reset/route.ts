import { z } from "zod";
import { limitSensitiveRequest } from "@/lib/risk/sensitive";
import { HttpError, json, readMutation, requestFailure } from "@/lib/server/http";

export const runtime = "nodejs";
// Reserve a protected endpoint without sending reset mail or changing passwords.
export async function POST(request: Request) {
  try {
    await limitSensitiveRequest(request, "password-reset");
    const parsed = z.strictObject({ email: z.string().trim().email().max(254) }).safeParse(await readMutation(request));
    if (!parsed.success) throw new HttpError(422, "Enter a valid email address.");
    return json({ error: "Password reset is not available yet." }, 501);
  } catch (error) { return requestFailure(error); }
}
