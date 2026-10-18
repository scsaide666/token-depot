import { readFileSync, writeFileSync } from "node:fs";
const read = file => JSON.parse(readFileSync(`../../work/performance/${file}`, "utf8"));
const before = read("before.json"), after = read("after.json");
if (before.stage !== "complete" || after.stage !== "complete" || !before.cleanupVerified || !after.cleanupVerified) throw new Error("Load runs must complete and clean up.");
if (![...before.results, ...after.results].every(row => row.billing.passed)) throw new Error("Billing checks failed.");
const key = r => `${r.mode}/${r.identity}/${r.concurrency}`;
const old = new Map(before.results.map(r => [key(r), r]));
const f = n => n === null || n === undefined ? "—" : Number(n).toFixed(2);
const mb = n => f(n / 1048576);
const rows = after.results.map(r => {
  const b = old.get(key(r));
  return `| ${key(r)} | ${f(b.successfulRps)} → ${f(r.successfulRps)} | ${f(b.latencyMs.p95)} → ${f(r.latencyMs.p95)} | ${f(b.errorRate * 100)} → ${f(r.errorRate * 100)} |`;
}).join("\n");
const detail = [before, after].flatMap(run => run.results.map(r =>
  `| ${run.metadata.label}/${key(r)} | ${f(r.successfulRps)} | ${f(r.latencyMs.p50)} | ${f(r.latencyMs.p95)} | ${f(r.latencyMs.p99)} | ${f(r.ttftMs.p95)} | ${f(r.errorRate * 100)} | ${f(r.gatewayResources.oneCoreCpuPercent.p95)} | ${mb(r.gatewayResources.peakWorkingSetBytes)} | ${r.database.peakConnections} / ${r.database.peakLockWaiting} |`)).join("\n");
const transports = after.results.filter(r => r.concurrency === 500).map(r => {
  const codes = {};
  for (const sample of r.samples) if (!sample.ok) { const code = sample.transportCode ?? sample.error ?? "unclassified"; codes[code] = (codes[code] ?? 0) + 1; }
  return `- ${key(r)}: \`${JSON.stringify(codes)}\``;
}).join("\n");
const frontBefore = read("frontend-before.json"), frontAfter = read("frontend-after.json");
const front = Object.keys(frontBefore).map(route => `| ${route} | ${frontBefore[route].gzipBytes} | ${frontAfter[route].gzipBytes} |`).join("\n");
const plans = read("query-plans.json");
const plan = value => value[0]["QUERY PLAN"][0];
const pBefore = plan(plans.before), pAfter = plan(plans.after);
const logBytes = readFileSync("../../work/performance/tests-complete.log");
const testLog = logBytes[0] === 255 && logBytes[1] === 254 ? logBytes.subarray(2).toString("utf16le") : logBytes.toString("utf8");
const passCount = testLog.split(/\r?\n/).filter(line => line.startsWith("PASS ")).length;
const checks = read("checks.json");
if (Object.values(checks).some(code => code !== 0)) throw new Error("Required checks failed.");
const direct = read("direct-500.json");
if (!direct.passed) throw new Error("Core concurrency verification failed.");
const text = `# 第 32 步性能与稳定性报告 — 2026-10-10

本次保留现有 UI 和计费规则。下列数据来自实际本地执行；500 并发的失败被计入错误率，不能把失败请求算作有效吞吐。

## 已完成的优化

- Wallet、ApiRequest、ProviderChannel 的加锁 SQL 同时读取当前行，减少每次正常请求的重复读取，保持原锁顺序、归属条件、数据库约束和幂等结算。
- 健康且状态未变化的通道成功时不重复写入 CLOSED/零失败状态，减少通道锁内一次更新。
- Redis 缓存公开模型目录和服务端模型配置；模型写入与版本失效处于同一 PostgreSQL 事务，直接 SQL 修改也失效。价格从字符串还原为 Decimal，权限/余额/Key 撤销状态不缓存。
- 增加最多 256 个、每个最多 12 KB 编码数据的进程内缓存，沿用数据库版本和 Redis 剩余 TTL，减少热路径 Redis 往返，不延长健康数据过期时间。
- 单兼容通道的五分钟健康统计缓存一秒并合并并发未命中。多通道保持实时统计，以免缓存影响原有即时排序；熔断、并发和容量始终实时加锁检查。
- Usage 分页直接复用相同筛选统计里的 COUNT，少一次计数扫描；Overview 只读取当月消费账本，不再为当月展示扫描终身消费；日期格式器每次图表构建复用。
- 连接池保留每实例默认 10 连接，增加有界配置、空闲回收和连接寿命，不通过扩池掩盖行锁瓶颈。已有安全 HTTP Agent 继续复用连接。
- 增加跨用户过期冻结查询索引及可信恢复命令，用户不发新请求也可由部署调度恢复；重复执行不重复扣费。调度需要部署方启用。
- 图表几何计算使用 memo/useMemo，轴格式器复用，移动指针时不重建折线路径。Markdown/代码高亮按需加载，Apple 布局与样式保留。

## 压测方法

同一 Windows 主机，Node ${after.metadata.node}，${after.metadata.hardware.logicalProcessors} 个逻辑处理器；单个 Next 生产实例、隔离 PostgreSQL aihub_auth_test、Redis DB15、本地 Mock Provider。真实 Gateway/Wallet/Provider admission 仍运行；仅测试限额提高，生产默认限额未改。

每档闭环虚拟用户发压 ${after.metadata.configuration.durationSeconds} 秒，再等待在途请求全部结束。普通/流式 × 多用户/同用户 × 10/50/100/500，共优化前后各 16 场景。成功 RPS 分母包含 drain 时间；TTFT 是首个非空内容，不是响应头。没有真实上游或支付费用。

这是短时单次比较，不是持续压力/生产容量结论。基线期间同机有短时类型和 lint 检查，数据库缓存/MVCC 状态及系统背景负载也不完全相同；吞吐差异需要更长的重复测试确认。原始配置、构建 ID/hash、每条请求及资源采样均保留。

| 场景 | 成功 RPS 前 → 后 | 全部请求 P95 ms 前 → 后 | 错误率 % 前 → 后 |
| --- | ---: | ---: | ---: |
${rows}

## 全部资源与延迟记录

CPU 为 Gateway 进程占一个核心的百分比 P95；原始 JSON 同时包含除以逻辑处理器数后的整机归一化值。内存为约一秒采样的峰值 Working Set，不含 PostgreSQL、Redis、Mock 和压测进程。连接/锁等待也是采样值，可能漏掉瞬时峰值。延迟分位数包含失败尝试，原始 JSON 另有仅成功请求分位数。

| 运行/场景 | 成功 RPS | P50 ms | P95 ms | P99 ms | TTFT P95 ms | 错误 % | CPU P95 % | RSS MiB | DB连接/锁等待峰值 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${detail}

优化后 500 并发错误分类：

${transports}

首轮 Redis-only 优化结果也保留在 [after-redis-only.json](../../../work/performance/after-redis-only.json)。它暴露普通响应额外缓存往返开销，随后补充有界近缓存并重新构建、测试和压测。500 并发连接错误在 Gateway 到达前发生，对这些失败没有创建账本；本次未把它们当作数据库错误或有效处理吞吐。

## 补充：500 个同钱包核心并发

另以 500 个同步发起的调用直接执行真实 Gateway handler，保留 Bearer 验证、Redis、模型路由、Mock 上游和 PostgreSQL 计费，耗时 ${f(direct.durationMs / 1000)} 秒：500 个返回 200，${direct.exactSuccessfulRecords} 个精确成功记录、${direct.exactUsageLedgers} 条精确账本，余额 100 → ${direct.balance}，冻结 ${direct.reservedBalance}，Pending ${direct.pending}。每次费用 0.0001，合计 0.05，无重复扣费或透支。

该 Node harness 仅在隔离数据库守卫下别名 Next 的 server-only 编译标记，不模拟认证或 Wallet。它绕过 HTTP listener，不代表 500 连接服务器容量；用于单独确认高并发财务一致性。原始 [direct-500.json](../../../work/performance/direct-500.json)。

## 数据库查询测量

在隔离 ${plans.fixtureRows} 行样本实际执行 EXPLAIN ANALYZE，临时等价索引事务回滚。恢复查询执行时间 ${f(pBefore["Execution Time"])} → ${f(pAfter["Execution Time"])} ms；执行计划 shared hit blocks ${pBefore.Plan["Shared Hit Blocks"]} → ${pAfter.Plan["Shared Hit Blocks"]}。该小样本没有证明延迟改善，新增索引主要让状态/到期范围扫描更精确，不能宣称数据库整体提速。现有分页与筛选复合索引保留，Admin 用户统计已批量聚合，未发现需要逐用户查询的 N+1。

## 前端构建记录

唯一 route-manifest 引用 chunk 的 gzip 字节总数（含共有 chunk；不是浏览器实际传输或 LCP）：

| 路由 | 优化前 gzip bytes | 优化后 gzip bytes |
| --- | ---: | ---: |
${front}

Playground 的 Markdown/高亮字节转移到按需 chunk；功能使用时仍需要下载。Dashboard/Usage 体积略增，优化针对图表交互重复计算，未宣称首屏速度提升。没有进行可重复的浏览器 FCP/LCP 实测。

## 验收

- lint、typecheck、完整 tests、production build：实际退出码均为 0。
- 完整测试日志共 ${passCount} 条 PASS；含缓存精度/失效/故障回退、恢复命令、权限、支付重复回调、并发计费、流式中断和官方 SDK。
- 优化前后所有 32 个压测场景的账本检查通过：未见负余额、残留冻结、重复账本或 HTTP 成功与结算不匹配；每档自建数据清理成功。
- 曾发现多通道短时缓存影响排序，已改为多通道实时读取；曾发现流式测试 Redis 未关闭导致进程不退出，已补齐资源清理并重跑完整套件。

## 当前瓶颈与未解决风险

- 500 虚拟用户的错误率见表，不能认定系统已达到稳定 500 并发容量。连接阶段失败必须结合服务器/网络/压测端进一步定位，不能凭该数据直接归因数据库。
- 单通道 admission/finish 行锁和同一 Wallet 的结算仍串行，这是当前一致性机制；未用缓存余额或无锁更新换取压测数字。
- 终身聚合、大范围 Provider 健康统计、深页 OFFSET，以及单用户大量过期冻结仍随历史规模增加开销；尚未做长期 soak、断电故障注入、跨机器部署或百万行压测。
- 健康提示单通道最多延迟一秒；多通道选择、价格写入失效与金融检查保持实时。Redis 失效可回退元数据，但限流故障仍失败关闭。
- 真实支付商户和备用真实通道尚未配置，此处验证的是本地签名支付 fixture 与 Mock Provider，不能代替上线联调。
- 保留原有流中断经济策略与既有依赖审计风险，见前一阶段安全报告；本阶段没有宣称绝对安全或改变取消收费政策。

操作配置与恢复部署见 [performance-operations.md](performance-operations.md)。原始证据：[before.json](../../../work/performance/before.json)、[after.json](../../../work/performance/after.json)、[query-plans.json](../../../work/performance/query-plans.json)、[测试日志](../../../work/performance/tests-complete.log)、[检查退出码](../../../work/performance/checks.json)。
`;
writeFileSync("docs/performance-report-2026-10-10.md", text);
console.log(`Saved report from measured runs; ${passCount} test PASS lines.`);
