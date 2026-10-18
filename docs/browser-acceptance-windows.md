# Token Depot 本机真实浏览器验收（Windows）

更新日期：2026-10-15。本指南针对**隔离 Docker 测试环境**，不连接正式支付商户或收费 AI 上游。此前记录的本地浏览器访问拒绝已不再作为本轮限制；是否通过验收，以本轮生成的原始结果和截图为准。

## 当前工具与测试入口

- 公开仓库不包含浏览器或本机测试缓存。请在自己的电脑安装 Playwright、Chromium 和 Lighthouse，并实际检查版本与启动状态。
- Lighthouse 需要可运行的 Chrome / Chromium。下面的 `C:\Program Files\Google\Chrome\Application\chrome.exe` 仅为常见 Windows 路径示例，请按自己的安装位置调整。
- 隔离 Compose 的 Caddy 只发布 `https://localhost:8443/` 到本机回环地址，使用本地测试证书。浏览器脚本对该地址启用 `ignoreHTTPSErrors`；这**不代表**公开域名的可信 HTTPS 已验证。
- Windows PowerShell 中使用 `npm.cmd` 和 `*.cmd`，以免命中可能被执行策略阻止的 `.ps1` 包装脚本。若换机后缺少测试依赖，先运行 `npm.cmd install --no-save --package-lock=false playwright lighthouse` 和 `& .\node_modules\.bin\playwright.cmd install chromium`。这些命令不应改动 `package.json` 或 lockfile。

## 启动隔离的生产构建

在 PowerShell 中进入项目。首次运行且**确认** `.env.docker-test` 不存在时，运行 `node scripts/prepare-local-docker-test.mjs` 生成被 Git 忽略的隔离测试配置；已有配置不要覆盖。该配置的 OpenAI、Anthropic、Gemini、DeepSeek Key 均为空。运行前再次确认目标确实是 `aihub-docker-test` 项目，而非正式数据库。

```powershell
cd 'C:\path\to\token-depot'
docker version
docker compose version
if (!(Test-Path .env.docker-test)) { node scripts/prepare-local-docker-test.mjs }
$compose = @('-f', 'compose.yaml', '-f', 'compose.local-test.yaml', '--env-file', '.env.docker-test')
docker compose @compose --profile ops --profile local-https config --quiet
docker compose @compose --profile ops build app migrate
docker compose @compose up -d postgres
docker compose @compose --profile ops run --rm migrate
docker compose @compose --profile local-https up -d app redis recovery sse-fixture caddy-local
docker compose @compose --profile local-https ps
curl.exe -k -I https://localhost:8443/login
```

容器构建与迁移配置见 [DEPLOY.md](../DEPLOY.md)，公开版本限制见[状态说明](open-source-status.md)。`curl -k` 只用于本地测试 CA；不要把跳过证书校验的方式用于生产。不要从 Windows 主机直接运行复制自 Linux 容器的 `.next` 构建产物。

本项目 Redis 使用 `network_mode: service:app`。如果仅重建了 app，随后注册/登录返回“Request protection is temporarily unavailable”，应让 Redis 重新共享当前 app 的网络命名空间；在确认仍是隔离项目后执行 `docker compose @compose up -d --no-deps --force-recreate redis`，不要通过关闭风控来处理。

如果 `Documents\Codex` 是指向其他磁盘的符号链接，Windows 原生 `tsx` 或 Next standalone 构建可能混用链接路径和实际路径。运行原生 UI 测试/构建前可以执行 `$projectPath = node -p "require('fs').realpathSync('.')"`、`Set-Location -LiteralPath $projectPath`，在同一个实际路径中运行命令。Docker 内构建不受这个 Windows 路径问题影响。

## 六视口、深浅主题与交互

在另一 PowerShell 窗口运行。`AIHUB_BROWSER_CREATE_TEST_USER=1` 会通过注册页在**隔离测试数据库**创建一个随机、零余额的普通用户，然后登录检查私人页面；只有确认上述隔离 Compose 站点时才能设置此开关。随机密码和 Session 只在测试进程内使用，不要保存或发送。

```powershell
cd 'C:\path\to\token-depot'
$env:AIHUB_BROWSER_BASE_URL = 'https://localhost:8443/'
$env:AIHUB_BROWSER_CREATE_TEST_USER = '1'
try {
  node scripts/browser-acceptance.mjs
} finally {
  Remove-Item Env:AIHUB_BROWSER_BASE_URL,Env:AIHUB_BROWSER_CREATE_TEST_USER -ErrorAction SilentlyContinue
}
```

脚本仅接受 `localhost` 或 `127.0.0.1` 的 HTTP(S) 根地址；不提供自动注册开关或专用测试账户时，登录后页面会被明确标为 `SKIP`。也可通过 `AIHUB_BROWSER_TEST_EMAIL` / `AIHUB_BROWSER_TEST_PASSWORD` 使用专用隔离账户，但不要使用管理员密码或把密码放入仓库、命令参数和报告。

脚本检查 **375、390、768、1024、1440、1920px** 六种宽度与 Light/Dark 两种主题。公开页面包括首页、Login、Register、Models、Pricing、Docs、五个法律/联系页面和 Design System；登录后包括 Dashboard、API Keys、Dashboard Models、Usage、Billing、Settings 和 Playground，共 19 页。它检查 Token Depot 标题与图标及旧品牌可见文字，同时记录 HTTP 状态、意外跳转、全局横向溢出、主题、console/page 错误与同源 API/请求失败，并执行导航、搜索、文档搜索、密码显示、API Key 创建弹窗取消、Usage 时间范围、Playground 设置与 API URL 展示等安全交互。**不会**创建 API Key、创建支付订单或向模型发送提示。

截图与 `results.json` 写入被 Git 忽略的 `browser-results/<时间戳>/`。截图可能包含隔离测试用户邮箱或余额，仅保存在本机；不要公开上传。人工检查排版、表格局部滚动、Dialog、触控目标和深色对比；自动化通过并不能替代视觉审查。

## Lighthouse：移动端与桌面端

保持隔离站点运行，使用系统 Chrome 测试本地 HTTPS。`--ignore-certificate-errors` 仅用于此处的内部测试证书。每次记录测试日期、构建版本和运行条件；比较前后性能时保持相同条件。

```powershell
cd 'C:\path\to\token-depot'
New-Item -ItemType Directory -Force browser-results | Out-Null
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
& .\node_modules\.bin\lighthouse.cmd https://localhost:8443/ --output=json --output=html --output-path=browser-results/lighthouse-mobile --chrome-flags='--headless=new --ignore-certificate-errors'
& .\node_modules\.bin\lighthouse.cmd https://localhost:8443/ --preset=desktop --output=json --output=html --output-path=browser-results/lighthouse-desktop --chrome-flags='--headless=new --ignore-certificate-errors'
node scripts/summarize-lighthouse.mjs
Remove-Item Env:CHROME_PATH -ErrorAction SilentlyContinue
```

`scripts/summarize-lighthouse.mjs` 读取 `browser-results/lighthouse-{mobile,desktop}.report.json`，输出 Performance、Accessibility、Best Practices、SEO、LCP、CLS、TBT 和可用时的 INP。先检查每条 Lighthouse 命令的退出码及报告中的 `runtimeError`；**没有有效报告就没有实测分数**。INP 通常依赖真实用户数据，汇总中的 `null` 不能算通过。重复测量时保留原始 JSON/HTML，不要只保留汇总。

## 结果判读与收尾

- 查看最近一次 `browser-results/<时间戳>/results.json` 的 `pass`、`fail`、`skip`、`fatalError`，逐项对应 PNG。`skip` 表示覆盖未完成；`fail` 要按 `issues`、`errors`、`offenders` 和截图定位。
- 全局 `documentWidth > viewport` 会标记横向溢出；数据表格自身的局部横向滚动可以接受。自动检查也无法证明所有按钮、弹窗、键盘和触控行为完整可用。
- 若 Chromium 无法启动，先运行 `& .\node_modules\.bin\playwright.cmd --version` 和 `& .\node_modules\.bin\playwright.cmd install --list`，确认项目本地安装与浏览器缓存；不要把静态 SSR 检查写成浏览器验收。
- 完成后可用 `docker compose @compose --profile local-https down` 停止**隔离测试项目**。不要加 `-v`，避免误删测试卷；不要操作正式部署项目。

Playwright 浏览器管理见[官方文档](https://playwright.dev/docs/browsers)，Lighthouse CLI 参数见[官方说明](https://github.com/GoogleChrome/lighthouse/blob/main/readme.md)。
