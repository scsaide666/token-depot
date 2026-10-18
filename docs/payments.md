# Payment order flow

Wallets, model costs, request cost snapshots and ledger amounts use CNY. The approved one-time conversion is **1 USD = 7 CNY**. It is a versioned, atomic PostgreSQL migration, not a live exchange-rate feature. It widens model/snapshot cost columns to `numeric(22,8)`, multiplies all monetary fields by seven, preserves token counts and markup, and records the conversion. Wallet and ledger values retain 20 decimal places. New model provider costs must be entered in CNY; no automatic upstream currency conversion occurs.

## HTTP boundary

- `POST /api/payments`: ACTIVE Session, same-origin JSON, UUID `Idempotency-Key`; strict body `{ "method": "ALIPAY" | "WECHAT", "amount": "50.00" }`. Amount is a decimal string from ¥1.00 to ¥10,000.00, at most two fractional places. Returns an owned checkout DTO. Missing merchant configuration returns 503 before creating an order.
- `GET /api/payments/:id/status`: current Session owner only. Returns order identity, original amount, CNY, PENDING / PAID / FAILED / CLOSED / REFUNDED, validity, server time, available/reserved balance and a QR image only for Pending. It never calls a provider or writes Wallet.
- `POST /api/payments/:id/refresh`: same-origin empty JSON body, current Session owner only. A server-controlled adapter queries the original provider and verifies the platform response. Alipay OpenAPI V3 trade queries use the documented `POST /v3/alipay/trade/query` JSON contract. Concurrent refreshes share an atomic ten-second query lease. A settled order needs no provider call.
- `GET /api/payments?page=1&pageSize=25`: owned recharge history, count and stable server pagination (maximum 50 rows). Billing also accepts `rechargePage` independently of transaction `page`.
- `POST /api/payments/callbacks/alipay`: RSA2 signature verification using the pinned Alipay public key; validates original app, seller, order and amount. Returns `success` only after successful transaction completion.
- `POST /api/payments/callbacks/wechat`: verifies raw-body RSA signature, configured platform key ID and timestamp before AES-256-GCM decryption with the API v3 key; validates app, merchant, CNY, order and gross amount. Returns 204 after transaction completion.

DTOs exclude private keys, API v3 keys, merchant identifiers, provider transaction identifiers, raw signatures and platform responses. No userId, walletId, paid outcome or alternate credit amount is accepted from the browser. Anonymous, suspended and cross-user requests fail at the server boundary, including ADMIN sessions viewing another user's order.

## Settlement and state

Native orders have five-minute validity. Creation persists immutable original amount and merchant identity before the provider call, with no wallet credit. Concurrent retries with the same owned attempt reuse one order; terminal attempts cannot be reused. At most ten new attempts per user per minute are admitted. Provider creation failures are shown as Failed without pretending payment succeeded.

Only the server's verified receipt type can enter settlement. The transaction locks Wallet first and the owned order second, matching API billing's lock order. It checks original amount, method, currency and merchant; credits the **database original amount**, preserves existing reserved balance, creates a unique RECHARGE ledger entry with before/after amounts and marks the order PAID. Database uniqueness on order ledger and provider transaction plus row locks prevent duplicate credit across callbacks, server query, retries and separate application processes. Any write failure rolls back all changes. Deferred database constraints require an exact matching owned ledger for every Paid order.

Expired Pending orders become CLOSED on owned reads/history. A closed order cannot return to Pending, change amount or regain a payment QR. If the platform confirms payment that actually completed while a local display timed out, its verified success may reconcile CLOSED / FAILED to PAID once. This credits already paid funds without reopening the order. A Pending platform query of an expired order triggers a platform close; a close/payment race is resolved by a second verified query or callback, never by assuming success.

Browser polling reads status every 2.5 seconds, never overlaps, and stops at five minutes or order expiry, whichever comes first. It aborts and clears timers on page exit/unmount and stops on terminal states. Refresh status is an explicit read or verified server query; it does not restart infinite polling. Payment success refreshes the account layout and Billing data and shows the recharged amount and current available balance. Full navigation to Billing / Transactions reloads owned history. There is no fabricated progress bar.

## Configuration

All configuration is server-only; see `.env.example`. Set `PAYMENTS_ENABLED=true` only with actual merchant configuration and a public HTTPS `PAYMENT_NOTIFY_ORIGIN`. Alipay requires app ID, seller ID and private/public RSA PEM file paths. WeChat requires app ID, merchant ID, merchant certificate serial, private RSA PEM path, pinned WeChat public key ID/path and a file containing the 32-byte API v3 key. RSA keys must be at least 2048 bits. Pin the public keys obtained from the respective merchant platform. Protect key files with operating-system permissions and keep them outside public assets/source control. Production calls use the official platform endpoints; no browser-supplied or environment fake-provider URL is supported.

Without merchant configuration, method buttons and order creation remain unavailable. Existing owned order/history reads still work. There is no production mock checkout or fake success endpoint. REFUNDED is reserved as a display status; refund operations and reconciliation are not implemented.

## Validation

Build first, then `npm run test:payments` and `npm run test:payment-polling`. Payment integration tests use only `aihub_auth_test` on loopback, generated test keys and locally signed provider responses. They exercise both adapters, signature and amount failures, cross-process duplicate callbacks with concurrent query/status reads, state expiry, immutable terms, transaction rollback, CNY precision, real history refresh and cross-user access. The one-time conversion is replayed in an isolated schema, including a `0.00000000000000000001` USD charge and rollback on attempted reapplication. Polling tests use a fake clock to cover the full five-minute budget without waiting five real minutes. No genuine charge or live merchant query is made.

References: [Alipay official Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all), [WeChat Native payments](https://pay.wechatpay.cn/doc/v3/merchant/4012791877), [WeChat transaction query](https://pay.wechatpay.cn/doc/v3/merchant/4012791900), [WeChat payment notifications](https://pay.wechatpay.cn/doc/v3/merchant/4012791861).
