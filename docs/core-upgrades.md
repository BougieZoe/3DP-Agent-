# 核心升级实施记录

分支：`feature/core-upgrades-data-loop-autofix-physics`
基线：local `main` @ `20509a97`（远端 fetch 当时超时，未确认 origin/main）

## P1 — 制造数据闭环（已完成）

### 行为变化

- 每次上传/重新分析都会创建一条独立的 `AnalysisRecord`（IndexedDB，本地）。
  记录包含 SHA-256 文件指纹、创建时间、材料/工艺上下文、测量摘要、评分与 findings。
- `REPORT` 标签页新增 `PRINT OUTCOME` 卡片：
  - 状态：success / partial / failure / unknown / not_tested。
  - STL/3MF 导出或 Auto-Fix 成功后，几何页出现默认折叠的
    `PRINTED IT? / RECORD OUTCOME` 入口，展开后复用同一张 `PRINT OUTCOME`
    卡片并绑定到本次导出的记录。
  - failure/partial 时可填**失败层号**与**失败类型**（翘曲、层间附着、拉丝、挤出不足等）。
  - 备注可选；未知/未测试永远不算成功。
  - 保存后回读校验，写入丢失会明确报错，不会显示“已保存”。
- 重新分析（材料、工艺族、单位、修复）会生成新记录；修复记录通过
  `repair.derivedFromRecordId` 指向前一条记录，并保存前后测量对比。
- 未提供文件指纹或本地存储不可用时，卡片显示“本次运行没有关联记录”，绝不猜测关联。
- 匿名上传接口已预留但默认**不联网**：`client/src/lib/outcomeUpload.ts` 的
  `localOnlyOutcomeUploader` 返回 `{ ok:false, reason:'local-only' }`。
  即使启用，payload 也不包含文件名、备注、自由文本失败描述、实际设置或工程决策；
  `fileHash` 是伪匿名标识，不是匿名化。

### 数据结构

- `ANALYSIS_RECORD_SCHEMA_VERSION` → `2`。
- `OutcomeRecord` 新增 `failureLayer: number | null` 与 `failureType: FailureType | null`；
  旧记录读取时缺失字段归一化为 `null`，非法值也归一化为 `null`。
- 新增 `FAILURE_TYPES` 常量；自由文本 `failureMode` 保留用于兼容。

### 关键文件

- `client/src/lib/analysisRecord.ts` — schema、失败类型、归一化。
- `client/src/lib/analysisHistory.ts` — IndexedDB 写入等待事务完成；outcome 新字段。
- `client/src/lib/analysisRuns.ts` — 每次分析运行创建并校验记录。
- `client/src/lib/outcomeUpload.ts` — 匿名 payload 边界与 no-op uploader。
- `client/src/components/PrintOutcomeCard.tsx` — 结果编辑 UI；可选 uploader。
- `client/src/components/STLUploadHandler.tsx` — `UploadedModel.fileHash/analysisRecordId`。
- `client/src/pages/Home.tsx` — 重新分析/修复写记录；REPORT 页挂载卡片。

### 测试

新增/更新：
- `client/src/lib/__tests__/analysisRuns.test.ts`
- `client/src/lib/__tests__/outcomeUpload.test.ts`
- `client/src/lib/__tests__/analysisRecord.test.ts`
- `client/src/components/__tests__/PrintOutcomeCard.test.tsx`
- `client/src/components/__tests__/ExportOutcomePrompt.test.tsx`

验证：`pnpm check`、`pnpm test`、`pnpm run build` 全部通过（P1 完成时；
加入导出入口后为 889 passed / 4 skipped / 1 todo）。

### 边界与未做

- `client/src/lib/printFeedback.ts` 仍是 Mesh Studio 的置信度校准数据源，未合并；
  本次的制造结果闭环使用 `AnalysisRecord.outcome`，两者职责不同。
- 匿名上传只有接口与默认 no-op，未接任何远端服务。
- P1–P4 全部完成。

## P2 — 修复回归闭环（已完成）

### 行为变化

- 修复不再以“跑完流程”即视为成功。服务端/Bridge 与浏览器/WASM 两条修复路径
  在返回前都必须调用 `verifyRepair(before, after)` 做再测量对比：
  - 没有修复前基线、或修复后拿不到再测量结果 → **拒绝**。
  - 任一硬回归 → **拒绝**，返回**原几何 + 原分析**；UI 显示 `REPAIR DISCARDED`
    和逐条回归原因，绝不 `commitModel`，也不写修复记录。
  - 有基线且无回归 → 接受；若没有任何关键指标改善，summary 明确写
    “no key metric improved”，不会把“没变差”说成“修好了”。
- 几何页新增 `AUTO-FIX & STL`：候选修改先按预期风险降低排序，再走同一条
  Tiered 修复 → 再分析 → 回归门禁；只有 `accepted` 才提交并直接下载**这次
  被验证的几何**，不读取可能已过期的 `uploadedModel.geometry`。拒绝则不导出。
- 最近一次修复验证（accepted / regressions / summary）显示在几何页修复按钮上方；
  新上传、材料/工艺/单位重分析都会清空旧验证结果。

### 判定规则

硬回归（任一条即拒绝）：
`baseline_unavailable`、`analysis_unavailable`、`empty_result`、
`non_manifold_increased`、`boundary_increased`、`watertight_lost`、
`holes_increased`、`min_wall_decreased`、`p5_wall_decreased`、
`volume_unreliable`、`volume_implausible`。

- `p5_wall_decreased` 与 `min_wall_decreased` 分开判定：只看最小值会漏掉
  “局部薄壁变多但最小值没变”的回归。
- 体积比超出 `[0.25, 4]` 视为不可信；再测量标记 `volumeReliable=false` 也拒绝。
- 改进项：恢复水密、非流形减少、边界减少、孔洞减少、min/p5 壁厚增加、
  体积可靠性恢复。改进不能抵消回归。

### 关键文件

- `client/src/lib/repairVerification.ts` — 纯函数快照与回归门禁、结构化原因。
- `client/src/lib/repairFlow.ts` — `runTieredRepair` 两条 Tier 都接入门禁；
  拒绝时返回原几何/原分析，带 `accepted`、`verification`、`tier`。
- `client/src/lib/repairTiers.ts` — `pickWasmSuggestion` 按 riskReduction、
  再按 confidence 排序候选。
- `client/src/pages/Home.tsx` — `performTieredRepair` 共享管线；拒绝不提交；
  `AUTO-FIX & STL` 仅在验证通过后导出本次几何；验证结果面板。

### 测试

新增：
- `client/src/lib/__tests__/repairVerification.test.ts` — 每条硬回归、改进、
  无基线/无再测量、空网格、体积边界、回归与改进并存。
- `client/src/lib/__tests__/repairFlow.test.ts` — 服务端与 WASM 两条路径：
  回归时返回原几何、接受时返回修复几何并只再测量一次。
- `client/src/lib/__tests__/repairTiers.test.ts` — 候选排序。

门禁有效性做了红/绿验证：临时把 `accepted` 改成恒 `true` 后，
`repairVerification` + `repairFlow` 有 8 个测试失败；恢复后 16 个全绿。
随后完整验证：`pnpm check`、`pnpm test`（872 passed / 4 skipped / 1 todo）、
`pnpm run build` 全部通过。

### 边界与未做

- Auto-Fix 复用 `runTieredRepair` 的单候选策略；服务端路径本身会处理整网修复，
  WASM 路径只应用排序后的最佳 `thicken_wall` 候选，不做多轮叠加。
- 回归判定只使用现有测量模块；没有新的壁厚/体积算法，也不修改
  `analysis/pipeline.ts` 的既有语义。
- 拒绝的修复不写 `AnalysisRecord`；目前只在本次会话显示原因，不持久化失败尝试。
- `beforeAnalysis` 必须与传入几何对应（当前由 `UploadedModel` 保证）；
  若未来支持异步几何替换，需要同时传递测量版本号。

## P3 — 材料/工艺可配置 Agent（已完成）

### 行为变化

- `PipelineFactory.build(material)` 的结果不再是“算完就丢”，而是真正决定一次运行：
  - `slots` 决定实际实例化并运行的 Agent；`materialFilter` 现在生效。
  - `debateRounds` 决定辩论轮数（concrete/eco 为 1，SLS/SLM 为 3，其余为 2）。
  - `jevEnabled` 决定是否发起 Jev early triage / final decision。
  - `recalibrationEnabled` 决定 Jev 标记异常后是否做定向重跑。
- 材料权重覆盖改为**运行时权重**：PipelineFactory 复制 slot 并应用覆盖，
  不改 registry。FDM 的 failure/optimization、SLA 的 geometry/printability 等
  覆盖只影响本次运行，不会写回 `localStorage`。
- early triage 的加权调整也改为运行时 `Map<AgentId, number>`，不再调用
  `registry.updateWeight`，因此不会把探索性调整变成永久配置。
- 修复了 orchestrator 测试与实现漂移：删除了 `new AgentOrchestrator(configs)`
  这类无效调用，改用 registry 配置并真实断言权重/过滤结果。

### 关键文件

- `client/src/agents/core/pipelineFactory.ts` — 复制 slot、应用材料权重覆盖。
- `client/src/agents/orchestrator.ts` — 按 pipeline 实例化/运行 Agent；
  辩论轮数、Jev、recalibration 全部由 pipeline 门控；运行时权重传递到
  辩论、共识与 voting records。
- `client/src/agents/core/agentRegistry.ts` — `getEnabled(material)` /
  `instantiate(material)` 的过滤能力继续作为唯一入口。

### 测试

新增：
- `client/src/agents/__tests__/pipelineFactory.test.ts` — FDM/SLA/concrete
  配置、materialFilter、权重覆盖不落盘。
- `client/src/agents/__tests__/orchestrator.test.ts` — 自定义权重、
  materialFilter 实际减少运行 Agent、运行时覆盖不落盘、early triage 不写 registry、
  concrete 不使用 Jev 且只辩论 1 轮、SLS 辩论 3 轮、FDM 启用 Jev。

红/绿验证：临时忽略 `pipeline.debateRounds` 后，concrete 与 SLS 两个测试失败；
恢复后 17 个测试全绿。把 `jevEnabled` 硬编码为 true 也会让 concrete 的
“不调用 Jev”断言失败。

### 边界与未做

- 四个内置 Agent 没有硬编码 materialFilter；它们都适用于现有材料。
  过滤能力已接线，只有注册自定义 slot 时才会排除 Agent。
- 材料权重覆盖优先于 registry 中保存的同名权重；当前没有权重编辑 UI，
  因此不存在“用户设置被静默覆盖”的交互冲突。若以后加入权重编辑，
  需要区分“用户显式权重”和“材料默认权重”。
- `getJevApiKey()` 在登录态返回空字符串的既有可疑行为未改；P3 只保证
  pipeline 可以关闭 Jev，不改变 Jev 自身的鉴权语义。

## P4 — 速度与确定性（已完成）

### 行为变化

- 新增 `analyzeWithTelemetry()` 作为需要留 profiling 的唯一边界：它强制
  `enableProfiling: true`，跑一次分析，记录 `triangleCount + 各模块耗时`
  到现有 `captureTelemetry`，并返回同一个 `UnifiedAnalysis`——不重复分析。
- 上传、材料重分析、工艺族重分析、单位切换、CAD 分析、打印评审与修复后
  再测量都走该边界；修复流程因此每次只重跑一次完整分析（一次
  `buildGeometryGraph` + 一次壁厚 BVH），不会为了 profiling 触发第二遍。
- WASM 修复新增显式方法来源：`manifold-offset`（真 solid offset）或
  `normal-fallback`（manifold 加载/offset 失败后的逐顶点法线偏移）。
  回退不再伪装成 manifold 结果；几何页验证面板显示本次实际方法。
- `normal-fallback` 与 manifold 路径共用同一回归门禁：候选几何必须重新测量
  且无回归才能提交/导出。回退只是候选，不是安全捷径。

### 关键文件

- `client/src/lib/analysisProfiling.ts` — 单次分析 + profiling + telemetry。
- `client/src/lib/telemetry.ts` — 既有事件聚合，现在有生产调用者。
- `client/src/lib/meshRepair.ts` — `applyRepairWithMethodAsync` 返回
  `{ geometry, method }`；`applyRepairAsync` 保持旧 API。
- `client/src/lib/repairFlow.ts` — outcome 带 `repairMethod`；两条 Tier 都过门禁。
- `client/src/pages/Home.tsx` — 修复验证面板显示 method；上传/重分析走 profiling 边界。
- `client/src/components/STLUploadHandler.tsx`、`client/src/lib/cadAnalysis.ts`、
  `client/src/lib/printReviewWorkflow.ts` — 接入 profiling 边界。

### 测试

新增：
- `client/src/lib/__tests__/analysisProfiling.test.ts` — 强制 profiling、
  单次运行、telemetry 参数。
- `client/src/lib/__tests__/meshRepairMethod.test.ts` — manifold 不可用时
  明确报告 `normal-fallback`，旧几何 API 兼容。
- `client/src/lib/__tests__/repairFlow.test.ts` — 增加 fallback 与 manifold
  两条路径都必须过门禁；接受路径只再分析一次。

红/绿验证：
- 去掉 `enableProfiling: true` → profiling 测试失败；恢复后通过。
- 把 fallback 的 method 改成 `manifold-offset` → 方法来源测试失败；恢复后通过。
- 忽略 `pipeline.debateRounds` / `jevEnabled`（P3）→ 对应测试失败；恢复后通过。

完整验证：`pnpm check`、`pnpm test`（887 passed / 4 skipped / 1 todo）、
`pnpm run build` 全部通过。

### 边界与未做

- profiling 只写入现有 localStorage 遥测与 dev console；没有新增性能仪表盘 UI。
- 没有跨 worker 调用的几何图/BVH 缓存：每次分析仍是新几何，缓存需要内容哈希
  与生命周期策略，容易产生陈旧结果；当前先保证“一次分析只构建一次”。
- manifold 单元测试 mock 了 WASM 加载失败路径，验证的是回退选择与门禁，
  不是 manifold 数值正确性；真实 manifold offset 仍由浏览器构建产物提供。
- 构建仍有既有的大 chunk 与 `import.meta` CJS 警告，未在 P4 处理。
