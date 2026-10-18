# API 风控

本阶段只修改服务端、运行时配置与测试，沿用现有 UI。Gateway 及敏感写入接口依赖 Redis；未配置、断开连接、命令超时或容量不足时返回 `503 risk_unavailable`，不继续调用上游或冻结余额。Redis / Upstash 配置及 IP 哈希 Secret 都是服务端环境变量。

## 本地运行

```sh
npm run db:start
npm run redis:start
npm run db:migrate
npm run dev
```

Windows 的 `redis:start` 从 [Memurai 官方](https://www.memurai.com/get-memurai) 取得版本固定为 8.2.0 的签名 MSI，验证 Janea Systems 签名后只提取文件到 `../../work/redis`。不安装 Windows 服务、修改 PATH 或添加防火墙规则。进程只绑定 `127.0.0.1:56379`，生成随机密码，使用 AOF、128 MB 上限和 `noeviction`，配置保存在忽略提交的本地文件中。开发库为 Redis DB 0；测试只允许独立的本机 DB 15 和随机命名空间，清理自身前缀，不运行 FLUSHDB。

```sh
npm run redis:status
npm run redis:stop
```

Memurai Developer 仅用于开发和测试，连续运行 10 天后需要重启；生产环境需另行配置 Redis 或 Upstash。已有托管 Redis 使用 `rediss://`；Upstash 使用 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`，通过 HTTPS EVAL 执行同一套 Lua。两组配置同时存在时使用 Upstash。连接与命令分别受 2 秒和 2.5 秒超时保护，日志不输出连接 URL、Token 或 Redis 原始错误。

## 请求流程与配额

1. 对 IP 和 endpoint 做入口 RPM 限流，覆盖无效 Key 请求。
2. SHA-256 验证平台 Key、生命周期及 ACTIVE 用户。
3. 对 userId / apiKeyId 做 RPM 判断，覆盖已认证的参数错误和模型不存在等请求。
4. 读取有界 JSON、验证消息与输出预算、查询启用模型。
5. Redis 原子判断四个维度的 TPM 和单 Key 并发，预占最大 Token 预算。
6. PostgreSQL 事务冻结余额、创建 PENDING 请求。
7. 在可取消的超时预算内调用上游，不自动重试。
8. 根据真实 Usage 成功结算，或失败释放冻结金额；保持原有 requestId 幂等性。
9. 释放并发租约、调整 Token 配额，写安全元数据日志。

| 维度 | 默认 RPM | 默认 TPM |
| --- | ---: | ---: |
| User | 60 | 200,000 |
| API Key | 60 | 200,000 |
| IP | 300 | 1,000,000 |
| Endpoint | 12,000 | 20,000,000 |

对应环境变量为 `GATEWAY_USER_*` / `GATEWAY_API_KEY_*` / `GATEWAY_IP_*` / `GATEWAY_ENDPOINT_*`。`GATEWAY_API_KEY_CONCURRENCY` 默认 10。旧 `GATEWAY_REQUESTS_PER_MINUTE` 仅作为未配置 Key RPM 时的兼容默认值。策略集中在 `lib/risk/config.ts`，后续可在服务端添加套餐策略；请求参数不能修改配额。

Redis TIME 提供统一时钟，RPM 使用滚动 60 秒窗口。Lua 在同一次 EVAL 中判断所有维度并增加 Token 预占、并发租约，使用统一 Redis Cluster hash slot；多个 Node 进程没有本地计数器。RPM 计入尝试次数，不在上游失败后退款。拒绝响应为 `429 rate_limit_exceeded`，带 `Retry-After`，不会创建钱包冻结或扣款。

TPM 入场预算为保守输入估算加输出上限。在途预占不会因请求跨过一分钟而失效，最长使用 5 分钟租约。完成后以实际 Usage 替换预占，并计入完成后的 60 秒窗口；未尝试上游的请求释放全部 Token 预占。上游失败且没有可信 Usage 时保留估算配额 60 秒，防止失败请求绕过 Token 限额，钱包仍不扣费。Redis 清理采用幂等标记，重复完成不会重复释放或增加配额。进程异常退出的并发租约到期后恢复。

## IP 信任边界

Web Request 没有可信 socket IP。`TRUSTED_IP_HEADER` 只接受部署时配置的一个单值 IP 头；反向代理必须移除客户端同名头、覆盖为真实连接来源，并禁止客户端绕过代理访问应用。不要配置客户端可以控制的透传 X-Forwarded-For。非法值、多值和未配置时进入共享 `unknown` 桶，属于保守默认值。

IP 使用不少于 32 字节随机 `IP_HASH_SECRET` 的 HMAC-SHA256，归一化 IPv6 / IPv4 映射地址。限流键和日志仅保存哈希，不保存原始 IP。所有应用实例必须共享 Secret、命名空间和策略，否则无法共享限额。

## 请求大小与 Timeout

| 限制 | 上限 |
| --- | ---: |
| Gateway Body | 256 KiB，同时检查 Content-Length 和实际流字节数 |
| messages | 64 |
| 单条 message | 32,768 字符 |
| 总 message 输入 | 131,072 字符 |
| max_tokens / max_completion_tokens | 32,768，正整数，不能同时设置 |
| JSON 读取 | 10 秒 |
| 敏感写入 Body | 8 KiB |

模型 Context 限制仍独立检查，配置默认输出预算也不能突破硬上限。价格和金额继续使用 Decimal。

上游默认 90 秒，配置最大 120 秒；短超时仅用于隔离测试等场景。超时通过 AbortSignal 终止 HTTP 请求和响应体读取，返回 `504 provider_timeout`，将 ApiRequest 标记 FAILED、释放冻结金额，不创建 USAGE 扣费账本。重复结算不重复扣款。若数据库结算本身不可用，返回原有 `503 billing_unavailable` 并保留可恢复的 Pending 记录；Redis 清理失败不会阻止钱包结算，也不会覆盖已提交的成功响应。

## 敏感接口

限流针对实际 POST 接口，不改变 `/login` / `/register` 页面。

| 接口 | 默认 IP RPM | 默认用户 RPM |
| --- | ---: | ---: |
| `/api/auth/login` | 10 | 邮箱数据库限流继续保留 |
| `/api/auth/register` | 5 | 邮箱数据库限流继续保留 |
| `/api/api-keys` | 10 | 10 |
| `/api/payments` | 10 | 10 |
| `/api/auth/password-reset` | 3 | — |

敏感写入在 Body 解析、密码 Hash 或订单创建前计数，额外有每 endpoint 默认 3,000 RPM 的容量保护。变量格式为 `RISK_<LOGIN/REGISTER/CREATE_API_KEY/PAYMENT_CREATE/PASSWORD_RESET>_<IP/USER/ENDPOINT>_RPM`。既有表单继续接收字符串 `error`，同时补充 `code` / `type` 和 Retry-After。密码重置只预留限流接口，合法请求返回 501，未实现邮件、密码修改或新的 UI。

## 异常记录与日志

短时间失败、无效 Key、创建 Key、创建支付订单、并发超限及 Provider 失败有独立的短期计数器和 `risk_signal` 日志。达到阈值时记录元数据；没有永久封号、用户状态修改或自动余额操作。

日志采用逐字段白名单，只允许 event、requestId、userId、apiKeyPrefix、model、endpoint、status、latencyMs、tokens、cost、IP hash 和固定 reason/count。禁止输出完整平台 Key、密码、支付私钥、上游 Key、Prompt、Response、原始 Headers、配置 URL 或错误对象。阈值日志中的 Key 仅有 13 字符 Prefix。

## 验证

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

新增 `test:risk` 使用实际 Redis Lua、独立 PostgreSQL 数据库、两个应用进程、断开 Redis 的第三个进程及本机模拟上游。覆盖 RPM、四维配额、Token 预占/实际值/幂等调整、窗口边界、100 并发、租约恢复、Upstash REST EVAL 合约、有界/分块 Body、消息和恶意输出预算、错误 Key、Provider 超时/失败、Redis 不可用、敏感接口、日志白名单和钱包账本对账。测试不会调用真实 Provider 或支付平台。
