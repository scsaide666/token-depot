import { createCipheriv, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { AlipaySdk } from "alipay-sdk";
import { AlipayProvider, type AlipayConfiguration } from "../lib/payments/providers/alipay";
import { WechatProvider, type WechatConfiguration } from "../lib/payments/providers/wechat";
import type { PaymentOrder } from "../generated/prisma/client";
import assert from "node:assert/strict";

export const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
export const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
export const alipayConfig: AlipayConfiguration = { appId: "2026000000000001", merchantId: "2088000000000001", privateKey: merchantKeys.privateKey, publicKey: platformKeys.publicKey, notifyUrl: "https://payments.example.test/api/payments/callbacks/alipay" };
export const wechatConfig: WechatConfiguration = { appId: "wxfixture2026", merchantId: "1900000001", privateKey: merchantKeys.privateKey, certificateSerial: "MERCHANT2026", publicKey: platformKeys.publicKey, publicKeyId: "PUB_KEY_ID_3000000001", apiV3Key: randomBytes(16).toString("hex"), notifyUrl: "https://payments.example.test/api/payments/callbacks/wechat" };
export type PlatformState = { amount: string; status: "PENDING" | "PAID" | "FAILED" | "CLOSED"; transactionId?: string; badSignature?: boolean };
export const platformStates = new Map<string, PlatformState>();
export const platformCalls = { create: 0, query: 0, close: 0 };
export function timestamp(date = new Date()) { return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " "); }
function alipayTrade(orderNo: string, state: PlatformState) {
  return { out_trade_no: orderNo, trade_status: state.status === "PAID" ? "TRADE_SUCCESS" : state.status === "CLOSED" ? "TRADE_CLOSED" : "WAIT_BUYER_PAY", total_amount: state.amount,
    app_id: alipayConfig.appId, seller_id: alipayConfig.merchantId, ...(state.status === "PAID" ? { trade_no: state.transactionId ?? `ALI${orderNo}`, gmt_payment: timestamp() } : {}) };
}
export function alipayNotification(order: PaymentOrder, changes: Record<string, string> = {}, valid = true) {
  const data: Record<string, string> = { ...alipayTrade(order.orderNo, { status: "PAID", amount: order.amount.toFixed(2) }) as Record<string, string>, notify_type: "trade_status_sync", sign_type: "RSA2", ...changes };
  const content = Object.entries(data).filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
  data.sign = valid ? sign("RSA-SHA256", Buffer.from(content), platformKeys.privateKey).toString("base64") : randomBytes(256).toString("base64");
  return new URLSearchParams(data).toString();
}
function signedHeaders(body: string, provider: "alipay" | "wechat", bad = false): Record<string, string> {
  const time = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("hex");
  const signature = bad ? randomBytes(256).toString("base64") : sign("RSA-SHA256", Buffer.from(`${time}\n${nonce}\n${body}\n`), platformKeys.privateKey).toString("base64");
  return provider === "alipay" ? { "alipay-timestamp": time, "alipay-nonce": nonce, "alipay-signature": signature } : { "wechatpay-timestamp": time, "wechatpay-nonce": nonce, "wechatpay-signature": signature, "wechatpay-serial": wechatConfig.publicKeyId };
}
function wechatTrade(orderNo: string, state: PlatformState) {
  const [whole, fraction = ""] = state.amount.split("."), total = Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")));
  return { appid: wechatConfig.appId, mchid: wechatConfig.merchantId, out_trade_no: orderNo, trade_type: "NATIVE",
    trade_state: state.status === "PAID" ? "SUCCESS" : state.status === "CLOSED" ? "CLOSED" : state.status === "FAILED" ? "PAYERROR" : "NOTPAY",
    amount: { total, currency: "CNY" }, ...(state.status === "PAID" ? { transaction_id: state.transactionId ?? `WX${orderNo}`, success_time: new Date().toISOString() } : {}) };
}
export function wechatNotification(order: PaymentOrder, changes: object = {}, options: { badSignature?: boolean; badTag?: boolean; serial?: string } = {}) {
  const nonce = randomBytes(6).toString("hex"), associated_data = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(wechatConfig.apiV3Key), Buffer.from(nonce)); cipher.setAAD(Buffer.from(associated_data));
  const clear = JSON.stringify({ ...wechatTrade(order.orderNo, { status: "PAID", amount: order.amount.toFixed(2) }), ...changes });
  const encrypted = Buffer.concat([cipher.update(clear), cipher.final(), cipher.getAuthTag()]); if (options.badTag) encrypted[encrypted.length - 1] ^= 1;
  const body = JSON.stringify({ id: `EV${randomBytes(8).toString("hex")}`, event_type: "TRANSACTION.SUCCESS", resource_type: "encrypt-resource", resource: { original_type: "transaction", algorithm: "AEAD_AES_256_GCM", nonce, associated_data, ciphertext: encrypted.toString("base64") } });
  return { body, headers: { "Content-Type": "application/json", ...signedHeaders(body, "wechat", options.badSignature), ...(options.serial ? { "wechatpay-serial": options.serial } : {}) } };
}
export async function localAlipay(): Promise<{ server: Server; adapter: AlipayProvider }> {
  const server = createServer(async (request, response) => {
    try {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const url = new URL(request.url!, "http://127.0.0.1"), data = raw ? JSON.parse(raw) : {}, orderNo = data.out_trade_no ?? url.searchParams.get("out_trade_no");
      let result: object;
      const validJsonPost = request.method === "POST" && !url.search && request.headers["content-type"]?.startsWith("application/json") && data.out_trade_no;
      if (url.pathname === "/v3/alipay/trade/precreate") {
        if (!validJsonPost || !data.total_amount) { response.writeHead(405); response.end("Invalid fixture request"); return; }
        platformCalls.create++; platformStates.set(orderNo, { amount: data.total_amount, status: "PENDING" }); result = { out_trade_no: orderNo, qr_code: `https://qr.alipay.com/fixture${orderNo}` };
      }
      else if (url.pathname === "/v3/alipay/trade/close") {
        if (!validJsonPost) { response.writeHead(405); response.end("Invalid fixture request"); return; }
        platformCalls.close++; platformStates.get(orderNo)!.status = "CLOSED"; result = { out_trade_no: orderNo };
      }
      else {
        // Alipay OpenAPI V3's trade/query contract is POST with JSON body.
        // Enforce it in the fixture so a GET/query-string implementation cannot pass locally.
        if (!validJsonPost || url.pathname !== "/v3/alipay/trade/query") {
          response.writeHead(405); response.end("Invalid fixture request"); return;
        }
        platformCalls.query++; result = alipayTrade(orderNo, platformStates.get(orderNo)!);
      }
      const body = JSON.stringify(result); response.writeHead(200, { "Content-Type": "application/json", ...signedHeaders(body, "alipay", platformStates.get(orderNo)?.badSignature) }); response.end(body);
    } catch { response.writeHead(500); response.end("Fixture failed"); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert(address && typeof address !== "string");
  const sdk = new AlipaySdk({ appId: alipayConfig.appId, privateKey: alipayConfig.privateKey, alipayPublicKey: alipayConfig.publicKey, keyType: "PKCS8", endpoint: `http://127.0.0.1:${address.port}`, timeout: 2000 });
  return { server, adapter: new AlipayProvider(alipayConfig, sdk) };
}
const wechatTransport: typeof fetch = async (input, init) => {
  const url = new URL(String(input)), body = String(init?.body ?? ""), headers = new Headers(init?.headers), auth = headers.get("authorization")!;
  const values = Object.fromEntries([...auth.matchAll(/([a-z_]+)="([^"]+)"/g)].map((match) => [match[1], match[2]]));
  assert(verify("RSA-SHA256", Buffer.from(`${init!.method}\n${url.pathname}${url.search}\n${values.timestamp}\n${values.nonce_str}\n${body}\n`), merchantKeys.publicKey, Buffer.from(values.signature, "base64")));
  const data = body ? JSON.parse(body) : {}, orderNo = data.out_trade_no ?? decodeURIComponent(url.pathname.split("/")[5]);
  let result: object | null;
  if (url.pathname.endsWith("/native")) { platformCalls.create++; platformStates.set(orderNo, { amount: (BigInt(data.amount.total) / BigInt(100)).toString() + "." + (BigInt(data.amount.total) % BigInt(100)).toString().padStart(2, "0"), status: "PENDING" }); result = { code_url: `weixin://wxpay/bizpayurl?pr=${orderNo}` }; }
  else if (url.pathname.endsWith("/close")) { platformCalls.close++; platformStates.get(orderNo)!.status = "CLOSED"; result = null; }
  else { platformCalls.query++; result = wechatTrade(orderNo, platformStates.get(orderNo)!); }
  const text = result ? JSON.stringify(result) : "";
  return new Response(result ? text : null, { status: result ? 200 : 204, headers: signedHeaders(text, "wechat", platformStates.get(orderNo)?.badSignature) });
};
export const localWechat = new WechatProvider(wechatConfig, wechatTransport);
