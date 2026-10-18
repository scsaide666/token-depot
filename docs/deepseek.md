# DeepSeek first

当前只启用 DeepSeek。OpenAI、Anthropic、Google Gemini 的 Adapter 保留，服务端密钥留空，现有美国 Provider 模型设为 disabled；不会自动创建美国模型，也没有跨 Provider fallback。通义千问、豆包等中国 Provider 等后续确认后再接入。

## 本地配置

在忽略提交的 `.env.local` 中私密配置 `DEEPSEEK_API_KEY`，不要粘贴到聊天、源码或 NEXT_PUBLIC 变量。Base URL 使用 `https://api.deepseek.com`，默认超时 90 秒。美国 Provider 的三个 `*_API_KEY` 保持空字符串。

在应用目录执行：

```sh
npm run configure:deepseek
npm run build
npm run smoke:deepseek
```

configure:deepseek 只允许 loopback 主机上的本地 aihub 开发数据库。它创建并启用 deepseek-flash，关闭其他三家 Provider 的现有模型，清空 `.env.local` 中对应的密钥配置，不修改钱包或历史记录。再次执行会复用相同 slug，保留管理员修改的名称、价格和倍率，只重新启用模型；若 slug 已路由到别的 Provider 或模型，会拒绝覆盖。它是显式本地管理脚本，不是公开写接口。配置修改后需要重启应用进程。

初始模型：

| Field | Value |
| --- | --- |
| Public slug | deepseek-flash |
| Provider | DEEPSEEK |
| Provider model | deepseek-flash |
| Display name | DeepSeek Flash |
| Context | 1,000,000 tokens |
| Input price baseline | ¥2 / 1M tokens |
| Output price baseline | ¥8 / 1M tokens |
| Markup | 1 |

模型 ID、上下文和初始价格基于 [DeepSeek 官方模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，核对日期为 2026-10-07。上游同时存在缓存命中和高峰 / 空闲时段价格。本阶段采用**固定高峰、缓存未命中的人民币基准价**，销售价格为该基准 × 管理员倍率；没有实现按时间或缓存命中自动变价。因此 ApiRequest.providerCost 和 Admin 利润仍按配置快照计算，不能视为 DeepSeek 实际账单的逐笔对账结果。管理员可以调整基准和倍率，已有请求快照不受影响。

## 请求

使用平台 API Key，不使用上游 DeepSeek Key：

```sh
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"Hello"}],"max_tokens":16}'
```

新用户余额仍为零，余额不足返回 402，不会请求上游。测试充值或真实支付没有启用；需要余额时通过现有 Admin Adjust Balance 操作，填写原因并记录账本。

平台支持普通与 SSE 流式纯文本响应。DeepSeek Adapter 使用 max_tokens，并关闭默认思考模式以保持现有文本契约；参考 [官方思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。流式请求始终向上游请求真实 Usage，用于现有 Decimal 计费；客户端可通过 stream_options.include_usage 接收最终用量。图片和工具参数仍未开放。SDK 与中断行为见 [Streaming](streaming.md)。

/models、/dashboard/models、/pricing、文档模型表以及 Settings 模型选项均读取 enabled=true 的实际目录。API 使用平台 slug，公开目录只返回销售价，不返回密钥、内部路由、成本或倍率。文档的 curl / JavaScript / Python 示例使用 deepseek-flash；SDK 名称 openai 表示兼容协议，不会调用美国 Provider。

## 验证

npm test 使用本地 PostgreSQL、Redis 和合成上游响应，不花费真实模型额度。npm run smoke:deepseek 是单独的真实请求：最多 8 个输出 Token，使用隔离测试数据库和临时测试钱包，验证真实 Usage、Last Used、USAGE 账本及 reservedBalance 释放后删除测试数据。

可使用 node --import tsx scripts/check-deepseek.ts 单独查询官方模型列表；只输出 HTTP 状态和经过筛选的模型 ID。错误不会输出密钥、原始上游内容或请求头。所有上游访问均保留 TLS 校验。
