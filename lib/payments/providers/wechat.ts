import "server-only";
import { createDecipheriv, randomBytes, sign, verify } from "node:crypto";
import { z } from "zod";
import type { PaymentOrder } from "@/generated/prisma/client";
import { money } from "@/lib/billing/money";
import { HttpError } from "@/lib/server/http-error";
import { boundedBody, PaymentProviderError, verifiedReceipt, type PaymentProvider, type ProviderIdentity } from "./types";

export type WechatConfiguration = { appId: string; merchantId: string; privateKey: string; certificateSerial: string; publicKey: string; publicKeyId: string; apiV3Key: string; notifyUrl: string };
const transaction = z.object({
  appid: z.string(), mchid: z.string(), out_trade_no: z.string().min(1).max(32),
  trade_state: z.enum(["SUCCESS", "NOTPAY", "USERPAYING", "CLOSED", "REVOKED", "PAYERROR", "REFUND"]),
  transaction_id: z.string().min(1).max(128).optional(), success_time: z.iso.datetime({ offset: true }).optional(),
  trade_type: z.literal("NATIVE").optional(), amount: z.object({ total: z.number().int().positive().max(1000000), currency: z.literal("CNY") }),
});
export class WechatProvider implements PaymentProvider {
  readonly identity: ProviderIdentity;
  constructor(private readonly config: WechatConfiguration, private readonly transport: typeof fetch = fetch) {
    this.identity = { method: "WECHAT", appId: config.appId, merchantId: config.merchantId };
    for (const value of [config.appId, config.merchantId, config.certificateSerial, config.publicKeyId]) if (!/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new Error("Invalid payment configuration.");
  }
  private verifyBody(headers: Headers, body: string) {
    const timestamp = headers.get("wechatpay-timestamp"), nonce = headers.get("wechatpay-nonce"), signature = headers.get("wechatpay-signature");
    if (headers.get("wechatpay-serial") !== this.config.publicKeyId || !timestamp || !/^\d{10,11}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      || !nonce || nonce.length > 128 || !signature || signature.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
      || !verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), this.config.publicKey, Buffer.from(signature, "base64"))) throw new HttpError(400, "Payment signature is invalid.");
  }
  private normalize(value: unknown) {
    const parsed = transaction.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "Payment confirmation is invalid.");
    const data = parsed.data;
    if (data.appid !== this.identity.appId || data.mchid !== this.identity.merchantId) throw new HttpError(400, "Payment merchant does not match.");
    if (data.trade_state === "REFUND") throw new PaymentProviderError(); // Refund reconciliation is deliberately not implemented.
    const paid = data.trade_state === "SUCCESS";
    if (paid && (!data.transaction_id || !data.success_time || Date.parse(data.success_time) > Date.now() + 300000)) throw new HttpError(400, "Payment confirmation is invalid.");
    return verifiedReceipt({ ...this.identity, orderNo: data.out_trade_no, amount: money(String(data.amount.total)).div("100").toFixed(2), currency: "CNY",
      status: paid ? "PAID" : data.trade_state === "CLOSED" || data.trade_state === "REVOKED" ? "CLOSED" : data.trade_state === "PAYERROR" ? "FAILED" : "PENDING",
      ...(paid ? { transactionId: data.transaction_id, paidAt: new Date(data.success_time!) } : {}),
    });
  }
  private async call(method: "GET" | "POST", path: string, payload?: object) {
    const body = payload ? JSON.stringify(payload) : "", timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("hex");
    const signature = sign("RSA-SHA256", Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`), this.config.privateKey).toString("base64");
    try {
      const signal = AbortSignal.timeout(8000);
      const response = await this.transport(`https://api.mch.weixin.qq.com${path}`, { method, redirect: "error", signal, headers: {
        "Content-Type": "application/json", Accept: "application/json",
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.identity.merchantId}",serial_no="${this.config.certificateSerial}",timestamp="${timestamp}",nonce_str="${nonce}",signature="${signature}"`,
      }, ...(body ? { body } : {}) });
      const text = response.body ? await boundedBody(response, 65536, signal) : "";
      this.verifyBody(response.headers, text);
      if (!response.ok) throw new PaymentProviderError();
      return text ? JSON.parse(text) as unknown : null;
    } catch { throw new PaymentProviderError(); }
  }
  async create(order: PaymentOrder) {
    const result = await this.call("POST", "/v3/pay/transactions/native", {
      appid: this.identity.appId, mchid: this.identity.merchantId, description: "Token Depot balance recharge", out_trade_no: order.orderNo,
      time_expire: order.expiresAt.toISOString(), notify_url: this.config.notifyUrl,
      amount: { total: Number(money(order.amount).times("100").toFixed(0)), currency: "CNY" }, // exact, bounded integer fen; no float-money arithmetic
    });
    const parsed = z.object({ code_url: z.string().max(2048) }).safeParse(result);
    if (!parsed.success || !parsed.data.code_url.startsWith("weixin://wxpay/bizpayurl?")) throw new PaymentProviderError();
    return { codeUrl: parsed.data.code_url };
  }
  async query(order: PaymentOrder) {
    return this.normalize(await this.call("GET", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.orderNo)}?mchid=${encodeURIComponent(this.identity.merchantId)}`));
  }
  async close(order: PaymentOrder) {
    await this.call("POST", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.orderNo)}/close`, { mchid: this.identity.merchantId });
  }
  async verifyNotification(request: Request) {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "Invalid payment notification format.");
    const body = await boundedBody(request); this.verifyBody(request.headers, body);
    try {
      const envelope = z.object({ event_type: z.literal("TRANSACTION.SUCCESS"), resource_type: z.literal("encrypt-resource"), resource: z.object({
        algorithm: z.literal("AEAD_AES_256_GCM"), original_type: z.literal("transaction"), nonce: z.string().min(1).max(32),
        associated_data: z.string().max(32).optional(), ciphertext: z.string().max(65536),
      }) }).parse(JSON.parse(body));
      const resource = envelope.resource, encrypted = Buffer.from(resource.ciphertext, "base64");
      if (encrypted.length <= 16) throw new Error("Invalid ciphertext.");
      const decrypt = createDecipheriv("aes-256-gcm", Buffer.from(this.config.apiV3Key), Buffer.from(resource.nonce));
      decrypt.setAAD(Buffer.from(resource.associated_data ?? "")); decrypt.setAuthTag(encrypted.subarray(-16));
      const cleartext = Buffer.concat([decrypt.update(encrypted.subarray(0, -16)), decrypt.final()]).toString("utf8");
      const receipt = this.normalize(JSON.parse(cleartext));
      if (receipt.status !== "PAID") throw new Error("Not a successful payment.");
      return receipt;
    } catch { throw new HttpError(400, "Payment notification is invalid."); }
  }
}
