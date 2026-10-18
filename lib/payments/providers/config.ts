import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import type { PaymentMethod, PaymentOptions } from "@/lib/payment-types";
import { HttpError } from "@/lib/server/http-error";

const fields = {
  ALIPAY: ["ALIPAY_APP_ID", "ALIPAY_SELLER_ID", "ALIPAY_PRIVATE_KEY_PATH", "ALIPAY_PUBLIC_KEY_PATH"],
  WECHAT: ["WECHAT_APP_ID", "WECHAT_MCH_ID", "WECHAT_CERT_SERIAL", "WECHAT_PRIVATE_KEY_PATH", "WECHAT_PUBLIC_KEY_ID", "WECHAT_PUBLIC_KEY_PATH", "WECHAT_API_V3_KEY_PATH"],
} as const;
function configured(method: PaymentMethod) {
  if (process.env.PAYMENTS_ENABLED !== "true" || !process.env.PAYMENT_NOTIFY_ORIGIN) return false;
  return fields[method].every((key) => !!process.env[key] && (!key.endsWith("_PATH") || existsSync(process.env[key]!)));
}
export function paymentOptions(): PaymentOptions {
  const methods = (["ALIPAY", "WECHAT"] as const).map((method) => ({ method, enabled: configured(method) }));
  return { methods, enabled: methods.some((item) => item.enabled) };
}
export function requirePaymentConfig(method: PaymentMethod) {
  if (!configured(method)) throw new HttpError(503, "Payments are not available yet. Please try again later.");
  const origin = new URL(process.env.PAYMENT_NOTIFY_ORIGIN!);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid payment configuration.");
  return { notifyUrl: `${origin.origin}/api/payments/callbacks/${method === "ALIPAY" ? "alipay" : "wechat"}` };
}
export function privateKey(path: string) {
  const pem = readFileSync(path, "utf8"); const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Invalid payment configuration.");
  return key.export({ type: "pkcs8", format: "pem" }).toString();
}
export function publicKey(path: string) {
  const pem = readFileSync(path, "utf8"); const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Invalid payment configuration.");
  return key.export({ type: "spki", format: "pem" }).toString();
}
export function apiV3Key(path: string) {
  const key = readFileSync(path, "utf8").trim();
  if (Buffer.byteLength(key) !== 32) throw new Error("Invalid payment configuration.");
  return key;
}
