import "server-only";
import { AlipaySdk } from "alipay-sdk";
import { z } from "zod";
import type { PaymentOrder } from "@/generated/prisma/client";
import { HttpError } from "@/lib/server/http-error";
import { boundedBody, PaymentProviderError, verifiedReceipt, type PaymentProvider, type ProviderIdentity } from "./types";

export type AlipayConfiguration = { appId: string; merchantId: string; privateKey: string; publicKey: string; notifyUrl: string };
const trade = z.object({
  out_trade_no: z.string().min(1).max(32), trade_status: z.enum(["WAIT_BUYER_PAY", "TRADE_SUCCESS", "TRADE_FINISHED", "TRADE_CLOSED"]),
  total_amount: z.string().regex(/^\d+(\.\d{1,2})?$/), trade_no: z.string().min(1).max(128).optional(),
  gmt_payment: z.string().optional(), send_pay_date: z.string().optional(),
  app_id: z.string().optional(), seller_id: z.string().optional(),
});
function alipayDate(value: string | undefined) {
  const date = value ? new Date(value.includes("T") ? value : `${value.replace(" ", "T")}+08:00`) : new Date();
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 300000) throw new HttpError(400, "Payment confirmation is invalid.");
  return date;
}
export class AlipayProvider implements PaymentProvider {
  readonly identity: ProviderIdentity;
  private readonly sdk: AlipaySdk;
  constructor(private readonly config: AlipayConfiguration, sdk?: AlipaySdk) {
    this.identity = { method: "ALIPAY", merchantId: config.merchantId, appId: config.appId };
    this.sdk = sdk ?? new AlipaySdk({ appId: config.appId, privateKey: config.privateKey, alipayPublicKey: config.publicKey, keyType: "PKCS8", signType: "RSA2", timeout: 8000, camelcase: false });
  }
  private normalize(value: unknown) {
    const parsed = trade.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "Payment confirmation is invalid.");
    const data = parsed.data;
    if ((data.app_id && data.app_id !== this.identity.appId) || (data.seller_id && data.seller_id !== this.identity.merchantId)) throw new HttpError(400, "Payment merchant does not match.");
    const paid = ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(data.trade_status);
    if (paid && !data.trade_no) throw new HttpError(400, "Payment confirmation is invalid.");
    return verifiedReceipt({ ...this.identity, orderNo: data.out_trade_no, amount: data.total_amount, currency: "CNY",
      status: paid ? "PAID" : data.trade_status === "TRADE_CLOSED" ? "CLOSED" : "PENDING",
      ...(paid ? { transactionId: data.trade_no, paidAt: alipayDate(data.gmt_payment ?? data.send_pay_date) } : {}),
    });
  }
  async create(order: PaymentOrder) {
    try {
      const response = await this.sdk.curl<unknown>("POST", "/v3/alipay/trade/precreate", { body: {
        out_trade_no: order.orderNo, total_amount: order.amount.toFixed(2), subject: "Token Depot balance recharge",
        notify_url: this.config.notifyUrl, timeout_express: "5m", qr_code_timeout_express: "5m",
      } });
      const data = z.object({ out_trade_no: z.literal(order.orderNo), qr_code: z.string().max(2048) }).parse(response.data);
      const url = new URL(data.qr_code);
      if (url.protocol !== "https:" || url.hostname !== "qr.alipay.com" || url.username || url.password) throw new PaymentProviderError();
      return { codeUrl: data.qr_code };
    } catch { throw new PaymentProviderError(); }
  }
  async query(order: PaymentOrder) {
    try {
      // SDK v3 verifies the signed HTTP response with the pinned Alipay public key.
      const response = await this.sdk.curl<unknown>("POST", "/v3/alipay/trade/query", { body: { out_trade_no: order.orderNo } });
      return this.normalize(response.data);
    } catch { throw new PaymentProviderError(); }
  }
  async close(order: PaymentOrder) {
    try { await this.sdk.curl("POST", "/v3/alipay/trade/close", { body: { out_trade_no: order.orderNo } }); }
    catch { throw new PaymentProviderError(); }
  }
  async verifyNotification(request: Request) {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") throw new HttpError(415, "Invalid payment notification format.");
    const values: Record<string, string> = Object.create(null);
    for (const [key, value] of new URLSearchParams(await boundedBody(request))) {
      if (Object.hasOwn(values, key) || ["__proto__", "constructor", "prototype"].includes(key) || value.length > 4096) throw new HttpError(400, "Payment notification is invalid.");
      values[key] = value;
    }
    if (values.sign_type !== "RSA2" || !values.sign || !this.sdk.checkNotifySignV2(values)) throw new HttpError(400, "Payment signature is invalid.");
    if (values.app_id !== this.identity.appId || values.seller_id !== this.identity.merchantId) throw new HttpError(400, "Payment merchant does not match.");
    if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(values.trade_status) && !values.gmt_payment) throw new HttpError(400, "Payment confirmation is invalid.");
    return this.normalize(values);
  }
}
