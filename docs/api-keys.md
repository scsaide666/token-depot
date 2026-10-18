# API Key 管理

## 范围

沿用现有 Apple 风格表格和 Dialog，提供持久化 Key 管理。页面通过当前 Session 获取本人记录，支持创建、重命名、撤销、删除以及掩码复制。Last Used 与 expiresAt 创建时为空；Gateway 已接入平台 Key 验证和请求日志，在尝试上游调用后更新 Last Used。详见 [gateway.md](gateway.md)。

## Secret

服务端以 `randomBytes(32)` 生成 256 位随机值，使用 base64url 编码并加上 `sk-aihub-`。立即对完整值计算 SHA-256；数据库只存 13 字符 Prefix 与 64 字符 Hash。完整 Key 仅在创建提交成功后返回一次，列表及其他操作只返回白名单元数据，不包含 Hash 或完整 Key。

创建结果仅保存在当前 Dialog 的内存状态。关闭 Dialog 即清除 Secret 并卸载 Copy 控件；不写入 localStorage、sessionStorage、URL 或 Cookie。用户主动复制后的剪贴板由用户保管。刷新页面不能从服务器恢复 Secret。密码继续使用 scrypt，API Key 使用适合高熵 Secret 的 SHA-256；比较工具使用等长 Buffer 与 timingSafeEqual。

## 接口与权限

- GET `/api/api-keys`：列表，仅查询 Session 用户的 userId。
- POST `/api/api-keys`：严格校验 `{ name }`，创建并返回一次 `{ apiKey, key }`。
- PATCH `/api/api-keys/[id]`：严格校验 `{ name }`，同时匹配 id 与 Session userId。
- POST `/api/api-keys/[id]/revoke`：空 JSON 对象，原子更新未撤销记录；重复撤销保留原始时间。
- DELETE `/api/api-keys/[id]`：空 JSON 对象，同时匹配 id 与 Session userId。

写操作沿用同源校验、JSON 请求体限制和 Zod。前端 userId / keyHash / expiresAt 等额外字段均拒绝。其他人的 ID 与不存在的 ID 均返回 404；所有接口都要求有效且 ACTIVE 的 Session，管理员也不能绕过 owner 检查。响应为 no-store，错误日志不记录 Secret 或请求值。

## 状态

revokedAt 非空时为 Revoked，否则已过期为 Expired，其余为 Active。读取列表、重命名和复制不更新 lastUsedAt。撤销及删除使用确认弹窗，默认聚焦 Cancel。提交期间锁定表单与关闭操作；列表失败可重试，操作失败保留当前输入，成功反馈使用简洁 status 文案。

## 验证

`npm run test:api-keys` 在独立本地测试数据库运行生产模式服务。覆盖创建与安全 Hash、重命名、幂等撤销、删除、过期、刷新后只返回 Prefix、匿名 / 暂停用户 / 跨用户权限及同源校验。前端另用浏览器验证一次性显示、复制反馈、确认取消、持久化与响应式布局。
