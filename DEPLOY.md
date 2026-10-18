# Token Depot 中国大陆部署指南
本指南提供生产配置模板和操作步骤。当前商用集成未验收；使用前先阅读[公开版本状态与限制](docs/open-source-status.md)，并自行完成主体、备案、域名、商户及供应商授权核实。本仓库未附带服务器、域名或商户配置。`token-depot.example` / 下文历史 `yourdomain.com` 均为占位符，不属于本项目。

## 架构与前置条件
广州优先，Ubuntu 24.04 LTS、x86_64。2核4GB仅作为受限低负载预发布起点；建议CVM标准型4核8GB、约100GB SSD。60GB只适合数据较少且镜像/备份受控的试运行，不能承诺可长期容纳增长。单机部署不是多节点高可用；备份必须离机。生产镜像在独立构建机生成，避免构建与数据库争抢内存。应用、数据库、Redis、恢复任务和Caddy的内存上限合计**3136 MiB（3.0625 GiB）**，尚未包括操作系统、Docker及突发余量；CPU限额合计2.4核是可竞争上限而非预留保证，2核时会争用。并发容量仍须目标机持续压测。

Next.js standalone 非 root 镜像。PostgreSQL 私有 internal 网络无宿主机端口。Redis 与 app 共用网络空间，绑定 127.0.0.1，有密码、AOF、noeviction；不能将 REDIS_URL 改成明文远程服务。只有 public profile 的 Caddy 发布 80/443，默认启动不包含它。应用保留原有 CSP、Session、限流、余额锁、结算及支付幂等逻辑。

生产Ubuntu统一用 `sh deploy/compose-production.sh`：固定本机Docker CE socket、项目aihub、项目Compose文件及显式.env.production；清除同名shell导出变量、隐式COMPOSE_PROFILES/文件和远程Docker上下文，避免预检文件与真正使用的Secret/镜像不同。wrapper不自动启用public，也不授权迁移/付款。它不用于Windows本机的隔离Compose项目。所有命令在/opt/aihub执行；不要自行换用未审核的Compose输入或旧UI标签。

生产秘密由云 Secret Manager 导出至服务器受限目录，Compose secret 挂载；Compose 非 Swarm，文件并非自动加密保险箱。禁止将密钥写入 .env.production、镜像、Git、聊天或命令参数。主机磁盘/离机备份需加密。任何曾公开或意外暴露的凭证必须在供应商控制台轮换后再部署。

## 1. 备案前准备
域名实名、主体信息须一致，按接入云服务商和所在地管局要求核对。
准备主体证件/营业执照、负责人证件与联系方式、域名注册证书、服务器及接入信息、网站名称/内容/服务类型、真实性核验材料。材料提交云服务商备案系统，不放进项目。
收费 Token/API 服务是否需增值电信业务许可、生成式 AI 下游登记或其他资质，必须请接入商/主管部门核实；ICP备案不等于全部业务许可。
备案期间安全组只放行管理员固定 IP 的 SSH 22；不放行 80/443，也不启动 public profile。不能用 IP、临时域名或“测试入口”绕过。
备案完成后核实备案号展示、链接工信部系统及公安联网备案流程/期限。没有真实备案号时不得编造。当前 UI 不显示备案号，上线前须补齐真实备案展示。
参见[完整上线合规清单](docs/open-source-status.md)。腾讯云[现行备案场景说明](https://cloud.tencent.com.cn/document/product/243/18910)要求服务开通后30个自然日内申请公安联网备案，具体流程与材料仍向属地公安核实；办理入口为 https://beian.mps.gov.cn/ ，本项目尚未申请或取得。

依据：[工信部域名规范通知](https://www.miit.gov.cn/jgsj/xgj/hlwgl/art/2020/art_f4e6b2b5bc6b400ea35b5d7294a960bd.html)、[云服务商备案前准备](https://support.huaweicloud.com/prepare-icp/ICP%E5%A4%87%E6%A1%88%E5%A4%87%E6%A1%88%E5%89%8D%E5%87%86%E5%A4%87-pdf.pdf)。

## 2. 安装环境
按 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)配置官方 apt 仓库，安装 docker-ce、docker-ce-cli、containerd.io、docker-buildx-plugin、docker-compose-plugin。不要 curl 未知脚本直接执行。国内网络无法下载时使用云厂商可信镜像仓库，校验来源/签名/摘要；不要代理绕过 AI 供应商地区限制。
```bash
sudo systemctl enable --now docker
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker --host unix:///var/run/docker.sock version
docker --host unix:///var/run/docker.sock compose version
sudo install -d -o "$USER" -g "$(id -gn)" -m 750 /opt/aihub
# 将项目源代码（不含 node_modules/.next/.env/本地数据/真实密钥）传入 /opt/aihub
cd /opt/aihub
cp --no-clobber .env.production.example .env.production
# 编辑为自己已实名认证的域名、真实 ACME 联系邮箱及版本化镜像标签
sudo install -d -m 700 deploy/secrets deploy/payment-keys backups
```
SSH 密钥登录、关闭密码登录、限制管理员 IP；使用云安全组与 Docker 防火墙规则。Docker 发布端口可能绕过普通 UFW 规则，不能只依赖 UFW。

## 3. 秘密配置
以 deploy/app.env.example 为结构，将 Secret Manager 导出的生产配置通过安全管道写入 deploy/secrets/app.env（例如 `secret-manager export ... | sudo tee deploy/secrets/app.env >/dev/null`；替换为实际秘密管理器命令）。不要把内容打印到终端或提交到仓库。填入 HTTPS APP_ORIGIN，保持 SEO_INDEXING_ENABLED=false、PAYMENTS_ENABLED=false；确认上线后再开启。
db-password（数据库管理员）、app-db-password（应用）、redis-password 三个 secret 文件使用独立的 32 字节随机 hex 值，app.env 的 DATABASE_URL 与 app-db-password、REDIS_URL 与 redis-password 必须分别一致；应用绝不使用数据库管理员凭证。IP_HASH_SECRET 使用独立至少 32 字节随机值。密码使用 hex 可避免 URL 编码歧义。
```bash
set -o pipefail
umask 077
# 只初始化全新的目录；任何旧文件/软链接存在即拒绝，不轮换已有数据库密码。
# noclobber和重定向在root子进程内执行；不打印秘密，不用tee覆盖旧文件。
sudo bash -c '
  set -euo pipefail
  umask 077
  set -o noclobber
  for name in db-password app-db-password redis-password; do
    if [ -e "deploy/secrets/$name" ] || [ -L "deploy/secrets/$name" ]; then
      echo "Existing secret retained; use a separately reviewed rotation procedure." >&2
      exit 1
    fi
  done
  for name in db-password app-db-password redis-password; do
    openssl rand -hex 32 > "deploy/secrets/$name"
  done
'
# 不在终端打印密码；用安全编辑器/秘密管理导出配置，并由授权部署账户管理
sudo chmod 600 deploy/secrets/db-password deploy/secrets/app-db-password deploy/secrets/redis-password
# PostgreSQL 入口脚本会切换到 postgres 用户，初始化脚本也在该用户下运行；两个数据库 secret 必须可读。
PG_IMAGE='postgres:17.11-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
sh deploy/docker-production.sh pull "$PG_IMAGE"
PG_UID=$(sh deploy/docker-production.sh run --rm --network none --entrypoint id "$PG_IMAGE" -u postgres)
sudo chown "$PG_UID:$PG_UID" deploy/secrets/db-password deploy/secrets/app-db-password
sudo chmod 400 deploy/secrets/db-password deploy/secrets/app-db-password
# app 非 root UID1000 必须能读取挂载文件，文件所有者设为1000；父目录仍为root 700
sudo chown 1000:1000 deploy/secrets/app.env
sudo chmod 400 deploy/secrets/app.env
```
支付私钥/API v3 文件同样 UID1000 可读、权限400。挂载整个支付目录时，父目录也必须允许 UID1000 遍历，部署后执行：
```bash
sudo chown 1000:1000 deploy/payment-keys
sudo chmod 700 deploy/payment-keys
# 导入每个支付文件后逐一设为UID1000所有、400权限，不打印文件内容
```
不要把生产 secret 上传至本地测试数据库。生产不配置 DATABASE_URL_TEST、REDIS_URL_TEST、AIHUB_LOCAL_PROVIDER_TESTS。

## 4. 构建、离线启动和迁移
以下操作默认不开放公网。
```bash
sh deploy/compose-production.sh config --quiet
# Node24预检只读检查；若服务器不装Node，可使用已审查的tools镜像：
# root仅用于此无网络/只读的一次性配置检查；DAC_OVERRIDE用于读取其他UID所有的400文件。
# 应用运行镜像仍为非root/drop ALL；预检不把该能力授予应用。
TOOLS_IMAGE=$(sh deploy/compose-production.sh --profile ops config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["migrate"]["image"])')
# 此前必须已导入、核对并扫描该digest镜像；预检不自动拉取未知镜像。
sh deploy/docker-production.sh image inspect "$TOOLS_IMAGE" >/dev/null
sudo sh deploy/docker-production.sh run --rm --pull never --network none --read-only --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges \
  --user 0:0 --mount type=bind,src=/opt/aihub,dst=/workspace,readonly \
  --workdir /workspace --entrypoint node "$TOOLS_IMAGE" \
  scripts/check-deployment.mjs --compose-env .env.production --app-env deploy/secrets/app.env
# 工具通过只代表预发布配置一致；域名/许可证/成本/商户/公网TLS仍需独立验收。
# 从已审查私有镜像仓库取得精确digest，或此前先完成可信离线docker load。
# @sha256生产引用用于pull/run，不执行以digest作为tag的compose build。
sh deploy/compose-production.sh --profile ops --profile public pull app migrate caddy postgres redis
sh deploy/compose-production.sh up -d postgres
sh deploy/compose-production.sh --profile ops run --rm migrate
# 先预览再应用地区限制：关闭美国供应商的数据库模型与通道，不改价格
sh deploy/compose-production.sh --profile ops run --rm migrate --conditions=react-server --import tsx deploy/restrict-mainland.ts
sh deploy/compose-production.sh --profile ops run --rm migrate --conditions=react-server --import tsx deploy/restrict-mainland.ts --apply
sh deploy/compose-production.sh up -d --wait --wait-timeout 180 app redis recovery
sh deploy/compose-production.sh ps
sh deploy/compose-production.sh exec app node -e "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1);console.log(r.status)})"
```
app 健康检查只检查 HTTP 活性，不代表 DB/Redis/计费全部就绪。Redis 启动前敏感请求按现有策略拒绝。首次空数据库没有管理员或模型，不能复制测试用户上线；受控运维在数据库内提升一个已注册实名运维账户角色，核对账户后执行并审计，不开放自动创建管理员的 HTTP 接口。通过 SSH 内网测试/独立预发布环境注册及验收，不能在未备案公网开放注册。

init-database.sh 仅在空PGDATA执行。若首次初始化因secret权限失败，不要直接对有真实数据的卷执行 down -v；先确认数据与备份，检查角色/初始化状态，在隔离环境修复后再启动。宿主机已有容器数据必须按原主版本和角色迁移，不能依赖首次初始化脚本重置凭证。

## 5. 上游与支付
生产 `tools` 镜像仅包含迁移、余额恢复及地区限制所需代码和依赖，没有 npm、ESLint 或 SDK 测试工具。隔离 Mock 测试使用独立的 `test-tools` target / `TEST_TOOLS_IMAGE`；不得将测试镜像作为生产 `TOOLS_IMAGE`。

仅允许经过确认的 DeepSeek 通道启用。正式 API 模型 ID、价格、地区、主体及转售/聚合授权必须按合同核实，不能照搬本地示例。管理后台按确认结果配置 Provider Model ID 和 CNY 成本/销售倍率。
[DeepSeek 开放平台协议](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)涉及开发者及终端用户义务；不能将可调用视为已获独立聚合转售许可。
中国大陆不在 [OpenAI](https://developers.openai.com/api/docs/supported-countries)、[Anthropic](https://www.anthropic.com/supported-countries)、[Gemini](https://ai.google.dev/gemini-api/docs/available-regions?hl=zh-cn)当前公开支持范围；生产例子密钥留空并运行 restrict-mainland 关闭相关模型和通道，不使用代理/跨区账户规避限制。地区政策随时间变化，部署当天重新核实；未知兼容备用通道保持禁用。

暂无商户配置：充值入口保持不可用。核验支付宝/微信商户主体、已签约产品、结算账户、应用ID、证书/验签公钥、回调地址和平台白名单后再配生产 secret。回调：
- https://yourdomain.com/api/payments/callbacks/alipay
- https://yourdomain.com/api/payments/callbacks/wechat

PAYMENT_NOTIFY_ORIGIN 用主站，非 api 子域名。真实商户配置完成后才设 PAYMENTS_ENABLED=true 并重建 app/redis；由经营者安排小额真实订单验证金额、验签、数据库 PAID、余额及 WalletTransaction 唯一入账。重复通知、并发主动查询、跨用户查询、失败/关闭订单不入账全部必须复验。禁止使用伪造“支付成功”作为上线证明。余额是人民币；退款功能仍未实现，不宣称支持在线退款。

## 6. DNS、HTTPS、SSE 与公网门禁
`deploy/Dockerfile.caddy` 保留 Caddy 2.11.7 标准模块，使用 Go 1.26.9 和 x/net 0.60.0 重编译已确认的安全修复；部署前再次扫描实际产物。容器以 UID/GID 10001 运行，丢弃 capabilities、启用 no-new-privileges 和只读根文件系统；仅 data/config 卷和 `/tmp` 可写。低端口通过容器网络命名空间内的 `ip_unprivileged_port_start=0` 使用，无需 root。

首次使用空卷时镜像已设置所有权。升级曾由 root 运行的 Caddy 时，先停服务并备份其 data/config 卷，再由受控一次性运维容器把这两个卷的所有者调整为 `10001:10001`；确认实际 Compose 项目和卷名后操作，不要递归修改宿主机目录。保留旧镜像及卷备份用于回滚。

备案、资质、域名实名、联系信息及协议确认完成后，在国内 DNS 服务设置根域 A、api A 指向真实服务器。仅配置实际可用的 AAAA；错误 IPv6 会导致证书/访问失败。CAA 应允许选定 ACME CA，443/80 入站与证书签发所需出站均可达。标准 Caddy 使用 HTTP/TLS 挑战，不要求 DNS API Token。

```bash
# 先验证 Caddy 配置（该命令不启动公网站点）
sh deploy/compose-production.sh --profile public run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# 经营者确认备案/其他前置事项后，再开放安全组80/443并执行：
sh deploy/compose-production.sh --profile public up -d caddy
curl -I http://yourdomain.com
curl -I https://yourdomain.com
curl -fsS https://yourdomain.com/api/models
```
Caddy 自动证书与 HTTP 跳转 HTTPS。api 子域只允许 /v1/*；主站承载UI/支付回调/Playground。同源登录 Cookie 不向 API 子域共享，SDK使用 Bearer Key。Caddy覆盖 X-AIHub-Client-IP，且 app 不发布端口；不能在它前面再接 CDN 而继续信任未经校验的客户端 header。无访问日志，避免请求URI/敏感header泄露；仅保留限量运行日志。

SSE 依赖 [Caddy 对 text/event-stream 自动即时刷新](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)，不启用全局 flush_interval -1，该模式不取消客户端断开后的上游工作。网关已有超时/断开处理。代理等待响应头 240 秒，应用停止宽限期 250 秒，为最多 120 秒的上游路由及前后数据库结算留出余量；仍需在真实服务器验证慢请求和断开结算。部署验收用 SDK/curl -N 验证逐块输出、[DONE]、Stop/断开取消及余额结算。不要在代理/CDN开启响应缓冲。

## 7. 备份与恢复

备份任务现在必须配置独立的 **32 字节二进制随机密钥**；缺少密钥或权限不合格会失败，不再默默保存新的明文 dump。`backup-crypto.mjs` 使用带认证的 AES-256-GCM（随机 nonce、认证标签），仅记录文件路径/成功状态。密钥不能与备份一起存放、上传或加入 Git。以下仅为目标机操作指南，本机验收没有执行生产定时器或离机传输。

```bash
# 在 recovery 已运行、镜像已审查的目标机生成新密钥；绝不输出密钥内容。
sudo install -d -m 700 /etc/token-depot
backup_image=$(sh deploy/compose-production.sh images -q recovery)
test -n "$backup_image"
sudo sh deploy/docker-production.sh run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 0:0 --mount type=bind,src=/etc/token-depot,dst=/keys --entrypoint node "$backup_image" \
  -e 'require("node:fs").writeFileSync("/keys/backup.key",require("node:crypto").randomBytes(32),{mode:0o600,flag:"wx"})'
# flag wx 拒绝覆盖已有密钥。先完成独立的密钥托管/恢复副本，再启用任务。
```

```bash
sudo install -m 644 deploy/aihub-backup.service deploy/aihub-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aihub-backup.timer
sudo systemctl start aihub-backup.service
sudo systemctl status aihub-backup.service
```
数据库每天03:00备份、成功后保留14天的加密 `.dump.enc` 及 SHA-256 清单。短暂的明文 staging 位于 mode-700 目录、由退出 trap 清理；旧明文备份不会被自动删除，需验证加密替代件与恢复后由经营者安全处置。校验和只能检测损坏，GCM 标签才提供带密钥的完整性认证。复制加密文件到另一台机器/对象存储、独立保管密钥及整机恢复仍须另行授权并实际演练。数据库只做pg_dump，不能把运行中的PG数据目录直接打包当作有效备份。另备份 Caddy data/config 卷、Redis AOF、私有配置/支付证书（单独加密密钥库）。Redis重启的限流状态不等于资金账本，数据库才是金额事实来源。每季度隔离恢复演练。
```bash
# 隔离库恢复演练，禁止直接覆写生产 aihub
sh deploy/compose-production.sh exec -T postgres createdb -U aihub_admin aihub_restore_check
sudo sha256sum -c backups/CHOSEN.dump.enc.sha256
backup_image=$(sh deploy/compose-production.sh images -q recovery)
sudo sh deploy/docker-production.sh run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 0:0 --mount type=bind,src=/opt/aihub/deploy/backup-crypto.mjs,dst=/backup-crypto.mjs,readonly \
  --mount type=bind,src=/opt/aihub/backups,dst=/backup \
  --mount type=bind,src=/etc/token-depot/backup.key,dst=/run/backup-key,readonly \
  --entrypoint node "$backup_image" /backup-crypto.mjs decrypt /backup/CHOSEN.dump.enc /backup/restore.tmp /run/backup-key
# 仅在认证解密成功后恢复到上面新建的隔离库，验证后安全移除 restore.tmp。
sudo sh -c 'sh deploy/compose-production.sh exec -T postgres pg_restore -U aihub_admin -d aihub_restore_check --exit-on-error --single-transaction < backups/restore.tmp'
```
recovery 每 60 秒运行有界幂等恢复任务；单个用户批次失败不会阻断其余用户，日志只记录批次数和剩余过期请求数，不输出用户身份或秘密。连续 5 分钟没有完整成功的恢复批次时容器会变为 unhealthy，运维应监控该状态与 `pendingExpiredRequests`，调查失败并人工重复运行积压批次。不能假定 Usage 缺失为零成本。

## 8. 更新与回滚
镜像用不可变版本标签，发布前保存上一版 APP_IMAGE、TOOLS_IMAGE、CADDY_IMAGE 值及对应 digest、Compose/Caddyfile 配置与数据库备份；扫描实际镜像并审查 HIGH/CRITICAL。现有安全报告中未解决项须处理，不能以 build 通过替代安全验收。首次目标机器验证镜像 tag/摘要存在并固定 digest。
```bash
# 在构建机完成lint/typecheck/tests/build及docker构建，传送新app/tools/caddy镜像
# 更新.env.production中的版本；从私有仓库pull，或用docker load导入镜像
sudo env BACKUP_KEY_FILE=/etc/token-depot/backup.key sh deploy/backup.sh
sh deploy/compose-production.sh --profile public stop -t 250 caddy
# 停止接入并给在途请求最多250秒完成后再迁移
sh deploy/compose-production.sh stop -t 250 app
sh deploy/compose-production.sh stop recovery redis
sh deploy/compose-production.sh --profile ops run --rm migrate
sh deploy/compose-production.sh up -d --wait --wait-timeout 180 --force-recreate app
# app 创建后重建共享其网络命名空间的 Redis，再恢复后台任务
sh deploy/compose-production.sh up -d --wait --wait-timeout 180 --no-deps --force-recreate redis recovery
sh deploy/compose-production.sh --profile public up -d --wait --wait-timeout 180 --no-deps --force-recreate caddy
```
仅向后兼容 migration 可直接回滚旧镜像。失败时先停止 Caddy，把 `.env.production` 的 APP_IMAGE、TOOLS_IMAGE、CADDY_IMAGE 恢复为已保存版本，并恢复该版本配套的 Compose/Caddyfile。代理的用户、文件 capability 和卷权限配置必须与其镜像配套，不能把旧镜像与新版硬化选项混用。保留当前 Secret 和账本数据；按上面的顺序重建 app、redis/recovery，验证健康后再重建 Caddy。不要执行 migrate reset 或 down -v。破坏性 schema 迁移需单独的停服与恢复方案，并核对新增交易不会丢失或重复入账。2 核单机更新存在维护窗口。

## 9. 验收与待办
逐项在隔离预发布和真实服务器执行，保存请求ID/脱敏账务证据：
- 登录/注册/注销、Cookie Secure/HttpOnly、跨账户API Key及数据隔离、Admin普通用户403。
- 模型slug映射、非流式与SSE SDK、真实usage计费、预冻结释放、重复结算、并发余额不负。
- DeepSeek网络/账户/模型权限、故障/429/超时；不自动切换不同能力模型。
- 支付真实小额到账与重复回调不重复加余额；商户未配置前标记未验收。
- 主站与API证书、80跳转、移动布局、域名canonical、联系/备案信息、无公开5432/6379/3000。
- Redis故障fail closed、DB恢复、系统重启自动恢复服务、离机备份还原。
- 2核4GB实际CPU/内存/磁盘/连接池压测，现有500并发本机传输失败风险不能解释为生产承载能力。

生产上线需要目标服务器实测，不能用本地自动化替代。原私有审计日志不包含在此公开快照内。
隔离 `local-https` 测试 profile 的运行方式见 [Windows 本地验收指南](docs/browser-acceptance-windows.md)；当前公开版本的限制见[状态说明](docs/open-source-status.md)。不要在本地测试时启用生产 `public` profile 或使用真实支付/上游密钥。
