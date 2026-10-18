import "server-only";
import type { PaymentMethod } from "@/lib/payment-types";
import { apiV3Key, privateKey, publicKey, requirePaymentConfig } from "./config";
import { AlipayProvider } from "./alipay";
import { WechatProvider } from "./wechat";
import type { PaymentProvider } from "./types";

// No mock/success flag or configurable upstream URL exists in production routes.
export function getPaymentProvider(method: PaymentMethod): PaymentProvider {
  const { notifyUrl } = requirePaymentConfig(method);
  if (method === "ALIPAY") return new AlipayProvider({
    appId: process.env.ALIPAY_APP_ID!, merchantId: process.env.ALIPAY_SELLER_ID!,
    privateKey: privateKey(process.env.ALIPAY_PRIVATE_KEY_PATH!), publicKey: publicKey(process.env.ALIPAY_PUBLIC_KEY_PATH!), notifyUrl,
  });
  return new WechatProvider({
    appId: process.env.WECHAT_APP_ID!, merchantId: process.env.WECHAT_MCH_ID!, certificateSerial: process.env.WECHAT_CERT_SERIAL!,
    privateKey: privateKey(process.env.WECHAT_PRIVATE_KEY_PATH!), publicKey: publicKey(process.env.WECHAT_PUBLIC_KEY_PATH!),
    publicKeyId: process.env.WECHAT_PUBLIC_KEY_ID!, apiV3Key: apiV3Key(process.env.WECHAT_API_V3_KEY_PATH!), notifyUrl,
  });
}
