# 探索总结 — 2026-11-16

> 项目根目录：`<repo>`（本文件所在仓库根目录）
> 当前分支：`feature/core-upgrades-data-loop-autofix-physics`（基线 `20509a97`）
> 探索范围：README / AGENTS / DESIGN / `client/src/agents` / `server` 桥接 / 分析测量 / 修复 / 测试 / CI

## 0. 当前状态（P1–P4 完成后）

> 更新于实现完成后。本文件保留原始探索结论，并同步当前事实。

- 当前分支：`feature/core-upgrades-data-loop-autofix-physics`，基线 `20509a97`。
- 工作区仍有未提交改动，但已不是“阻塞实现的 WIP”：P1–P4 代码与文档已完成，
  等待 review 后决定是否提交。
- P1 的 `AnalysisRecord` / `analysisHistory` / `PrintOutcomeCard` 已接线：
  REPORT 页可记录实测结果；每次上传/重新分析/修复都会写入独立记录。
- P2–P4 已完成：统一修复回归门禁、Auto-Fix 导出门禁、运行时 Pipeline 参数、
  分析 profiling 与 manifold 方法来源均已落地。
- 最近一次全量验证：`pnpm check`、`pnpm test`（887 passed / 4 skipped / 1 todo）、
  `pnpm run build` 全部通过。

## 1. 多 Agent 如何协作与共识

- 四个核心 Agent：`GeometryAnalyst`、`PrintabilityScorer`、`FailurePredictor`、
  `OptimizationAdvisor`，都继承 `BaseAgent`，实现 `analyze()`，可选 `review()`。
- `AgentOrchestrator.runFullAnalysis()` 流程：
  1. 构造 `AgentContext`（几何、统一分析、顶点数据、材料、语言、可选 vision）。
  2. 可选 vision LLM（`visionProvider`），15s 超时；vision 只作辅助证据，
     `FailurePredictor` 不允许仅凭渲染图给出 critical。
  3. Agent 并行执行（每个有 registry 超时；超时返回 inconclusive 而非崩溃）。
  4. 辩论阶段最多 2 轮：每个 Agent 对其他输出给 `scoreAdjustment`，
     分数限制 0–100；当 agreementDelta < 10 提前结束。
  5. 可选 Jev：early triage + 最终共识 + 异常检测 + 只重跑最差 1 个 Agent，
     混合比例 60% 原始 / 40% 重跑。
  6. 加权共识：registry 权重，Jev 可用时用 Jev 分数覆盖。
  7. 事件 `agent-consensus` 广播给 3D office。
- 输出 `AgentRunSummary`：各 Agent 结果、consensus、投票记录、耗时、是否用 vision、
  可选 recalibrations。
- `AgentRegistry` 负责启用/禁用/权重/超时/优先级与 localStorage 持久化；
  `TelemetryHub` 提供状态流，供工厂可视化。

## 2. 测量 → 修复 → 再测量的闭环

- 测量入口：`runAnalysisPipeline()`（`client/src/analysis/pipeline.ts`）串行运行
  topology / validation / metrics / scaleGuard / bedFit / support / printTime，
  再按材料家族运行 resin/fgf/pbf/concrete/eco/loop/thermal/metal/multiMaterial 等模块。
- 关键测量：
  - 墙厚：`wallThickness.ts` 使用 BVH raycast，输出 min/avg/p1/p5/p10/median、
    thinWallRatio、samples；没有命中时返回 `null`，不伪造。
  - overhang：面积加权比例 + Z-up 朝向 + build-plate 排除。
  - 体积：有符号四面体求和，`volumeReliable` 明确标注开壳时体积不可信。
  - manifold：`nonManifoldEdgeCount`、`boundaryEdgeCount`、shell 数。
- 修复入口：
  - UI `handleRepairProcess` → `runTieredRepair()`。
  - Tier 1：`/api/mesh/process` → Python trimesh + pymeshfix（补洞/置床/可选减面）。
  - Tier 2：浏览器 WASM `manifold-3d` 的 `offset()`（真实体偏置）+ `+normal` 回退。
  - Tier 3：无桥接且无合适薄壁建议时诚实报错。
- 再测量：两条 Tier 都会在返回前调用 `analyzeWithTelemetry` 重跑完整分析。
- 当前硬性保护（P2 已补齐）：
  - 服务端与 WASM 两条路径都调用统一的 `verifyRepair(before, after)`。
  - 无基线、无再测量、空结果、non-manifold/边界增加、水密性丢失、
    体积异常、薄壁 p5/比例变差等任一硬回归 → 拒绝，返回原几何与原分析。
  - 被拒绝的修复不会 `commitModel`，不会写修复记录，也不会被 Auto-Fix 导出。
  - 已接受但没有任何关键指标改善时，summary 明确写 “no key metric improved”。
  - WASM 优先使用 manifold 真实体偏置；回退路径同样必须通过回归门禁。
- 版本历史：每次修复保存独立 `AnalysisRecord`，通过
  `repair.derivedFromRecordId` 指向前一条记录，并保存前后测量对比。
  REPORT 页记录实际打印结果；导出/Auto-Fix 成功后提供轻量结果记录入口。

## 3. Bridge 与前端的职责边界

- 前端：解析/归一化/自动定向、浏览器内分析、Three.js 渲染、WASM 修复、
  UI 与导出；不持有 `BRIDGE_TOKEN`。
- Bridge（`server/`）：CAD 生成、STEP 解析、slicer 调用、mesh 处理；
  仅在 operator 显式设置 `BRIDGE_TOKEN` 时生产环境挂载。
- 开发环境：`server/loopbackGuard.ts` 只对真实 loopback 调用者跳过 token；
  依据 `x-forwarded-for` 链，且仅当直接 socket peer 为 loopback 时信任；
  绝不依据 Express bind host。`vite.config.ts` 的 `xfwd: true` 必须与 guard 保持同步。
- Bridge 进程有沙箱：隔离解释器 `-I`、清洗过的环境变量、ulimit（内存/CPU/文件大小）
  和超时；mesh 诊断通过 sidecar 文件而非 stdout，避免 trimesh 警告污染 JSON。
- 生产浏览器不调用 bridge；`REPAIR & PROCESS` 被明确定位为内部/开发调试能力。

## 4. 已有不变量与明确拒绝/推迟的方案

不变量（AGENTS.md / DESIGN.md）：
- 因果关系引擎必须确定性、可审计；不允许 LLM 生成因果链替代规则引擎。
- 4 个 Agent 是“对同一静态模型的多视角分析”，并行 + 辩论，不是串行 supervisor-worker。
- 产品范围是打印前分析，不是实时打印机控制。
- 播放进度单一来源 `progressRef`；3D overlay 只叠加、不修改基础网格材质/颜色。
- marker 必须携带有限坐标；overlay 必须跳过非有限坐标，不能让一个坏 marker 卡死 Canvas。
- 薄壁 marker 只能来自真实测量样本；没有测量信号就不生成。
- 未知/未测试不等于成功；缺失制造上下文用 `null`，不伪造默认值。
- 每个持久化事实只有一个写入者；同一分数不能有两套公式。
- 新功能优先新增隔离文件，不改共享根组件；如需改必须明确说明。
- 规则用带 schema/validator 的数据配置表达；结论携带机器可读 reason
  （rule id、测量值、阈值）；每个能改变结果的规则至少有一个只触发该规则的测试，
  并验证移除规则时测试变红。
- 验证标准：先复现、再修复、再 stash 确认 bug 回归、再恢复；仅有旧测试通过不算证据。
- 不可逆操作（kill、rm -rf、force-push 等）必须先说明目标、影响范围、回滚方案并获批。

明确拒绝：
- LLM 驱动的动态因果推理（2026-08-29）。
- Supervisor-Worker 串行 Agent 架构（2026-08-29，除非未来出现真正的步骤门控需求）。
- 打印机实时控制的 tool-call 接口层（2026-08-29，超出当前产品范围）。

推迟：
- 上述串行 Agent 与 printer control 两项。
- README 路线图中的 Manufacturing Knowledge Graph、Historical Failure Memory 仍未实现。

## 5. 当前最大的技术债 / 薄弱点

1. **反馈数据源已收敛**：`AnalysisRecord.outcome` 是权威记录；
   `lib/printFeedback.ts` 是版本化派生校准索引（`source: 'analysis-record'`）；
   `lib/feedback.ts` 仅存产品反馈。旧 `3dp.printFeedback` 会一次性迁移并删除。
2. **Jev 路径缺陷已修复**：空字符串是“服务端持有密钥”的 sentinel，
   只有 `undefined` 才跳过；recalibrator 在改写分数前保存 `originalScore`。
3. **历史/版本能力弱**：`RepairLink` 只保存一条派生关系，没有完整版本链或回滚 UI。
   记录已可写入，但浏览器历史列表/恢复入口尚未产品化。
4. **性能**：每次修复都会完整重跑分析（正确性要求），但几何图/BVH 可缓存，
   仍存在重复构建；报告 tab 同步生成 quick report。
5. **两套后端**：`server/` TypeScript 与 `go-backend/` Go 功能重叠，
   mesh/process 的权威实现需明确（当前前端调用 TS `server/meshProcess.ts`）。
6. **历史记忆未实现**：Manufacturing Knowledge Graph 与 Historical Failure Memory
   仍只在 README 路线图中。
7. **校准已消费实测结果**：`PrintOutcomeCard` 保存后写入版本化 calibration store，
   并按 `rulesVersion + thresholdsHash + inputHash` 分组；尚未把结果自动反馈到
   Agent 权重或 Jev 的拟合任务（仍只报告，不自动改阈值）。

## 6. 四个优先级的落点（探索结论，均已完成）

- **P1 数据闭环**：扩展 `OutcomeRecord`（失败层级/失败类型）+ `PrintOutcomeCard`；
  在 Home 用 `fileHash + material + units` 建立/保存 `AnalysisRecord` 并传入 recordId；
  报告页与导出流程挂载轻量入口；新增可替换的匿名上传接口（默认 local-only 空实现）。
- **P2 强制闭环**：新增统一的 `evaluateRepairRegression(before, after)`（纯函数 + 单测），
  在 `runTieredRepair` 两条路径都执行；回归则返回原模型并带结构化丢弃原因；
  Home 显示“已丢弃（回归）”；新增一键 Auto-Fix & Export，导出前必须通过验证。
- **P3 可配置流水线**：真正使用 `PipelineFactory.build()` 的 slots/参数；
  让 registry 按材料过滤实例化；把 early-triage 权重调整改为运行时权重而非持久化写入；
  补充 FDM/SLA 配置测试，保持 4 个核心 Agent 可运行。
- **P4 速度/确定性**：为分析提供 profiling；避免修复后重复构建几何图/BVH；
  验证 true solid offset 路径（manifold）在失败时明确回退、且回退也经过回归门禁。

## 7. 实现状态与剩余决策

- `feature/core-upgrades-data-loop-autofix-physics` 已按 P1–P4 拆分提交，
  并合并进 `feature/decision-record-calibration`（merge `a09bb2b9`）。
- P1–P4、Jev sentinel/recalibration 修复、反馈源统一均已完成并通过全量验证。
- 当前无实现阻塞项。下一步：浏览器历史列表/回滚 UI、匿名聚合的可选远端实现，
  以及实测结果驱动的权重校准（只生成 review 建议，不自动改阈值）。
