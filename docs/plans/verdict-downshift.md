# 判定层下沉与车间层补位：现状核对与落地路线

> 编制日期：2026-11-23
> 基线：`origin/main` @ `be051595`
> 执行分支：`feat/verdict-downshift`
> 本文档中的所有数字均来自对本仓库的实测，不含估算。

---

## 一、一页结论

**中段很厚，但站错了位置；上游有真集成，下游是空白。**

- 可打印性判定引擎已有相当体量（44 个模块 / 11079 行），但 100% 运行在浏览器 Web Worker 里，服务端完全不具备判定能力。
- 几何与切片侧是真集成（`slicerBridge.ts` 通过 `execFile` 实际调用 PrusaSlicer / OrcaSlicer / BambuStudio；`go-backend/slicer` 有完整 bridge/gcode/router）。
- 车间与设备侧几乎是空的：机台配置只有 1 份（`server/data/machines/large-format-fgf.json`），没有 job / 排队 / 执行记录的数据模型，`telemetry.ts` 是分析过程的埋点，不是设备遥测。

因此三件事有明确先后：**先把判定搬出浏览器 → 再建车间数据模型 → 最后开 MCP 出口**。顺序颠倒会导致下游没有可复用的判定能力，MCP 只能包一层空壳。

---

## 二、现状核对（实测）

### 2.1 三层体量

| 层 | 位置 | 实测规模 | 性质 |
|---|---|---|---|
| 几何 / 网格 | `client/src/analysis/*.ts`（44 模块，非测试） | 11079 行 | 真实现，含网格拓扑、壁厚、支撑、切片估算、树脂/FGF/PBF/混凝土等多工艺分支 |
| 切片集成 | `server/slicerBridge.ts`、`go-backend/slicer/*.go` | bridge/gcode/router/types 四文件 | **真集成**：`execFile` 实际拉起本机切片器 CLI 产出真 G-code |
| 可打印性判定 | 同 `client/src/analysis`，入口 `analysis.worker.ts` | 判定逻辑 1–14ms 可跑完 | 逻辑完整，但**运行时被锁在浏览器** |
| 共享领域契约 | `shared/domain/printability.ts` | 25 行 | **仅类型定义**，无实现 |
| 服务端 | `server/*.ts` | 33 文件 / 6114 行 | 以 relay / 桥接 / 沙箱为主，无判定接口 |
| 车间 / 设备 | `server/data/machines/` | **1 台**（large-format-fgf.json） | 单机样例，无 job 模型、无队列、无执行记录 |
| 遥测 | `client/src/analysis/telemetry.ts` | — | **是分析过程埋点，不是设备遥测**，不能当作 MES 底座 |

### 2.2 仓库状态

| 项 | 值 |
|---|---|
| 基线 HEAD | `be051595`（与 `origin/main` 同指向） |
| 本地分支数 | 63 |
| 远程分支数 | 17 |
| 开工前工作区 | 4 处在途改动（`server/index.ts`、`vite.config.ts` 已修改；`server/bridgeGuard.ts`、`server/__tests__/bridgeRoutes.test.ts` 未跟踪） |

### 2.3 判定引擎对浏览器的实际耦合度（实测）

逐模块核对 44 个模块的 import 后，对浏览器运行时的依赖只有：

| 依赖类型 | 模块数 | 具体模块 |
|---|---|---|
| `three.js` | 2 | `geometryConversion`、`wallThickness` |
| DOM API | 3 | 渲染/导出相关 |
| Worker / 消息 | 3 | `analysis.worker`、`workerPool` 等 |

`pipeline.ts` 本身是纯计算，仅依赖 `@shared/*` 领域常量。**结论：判定层下沉在技术上没有硬阻塞，成本主要在出口封装，不在算法迁移。**

---

## 三、分层判断

### 3.1 当前结构的真实问题

1. **能力位置与使用场景错配**
   判定是"制造现场的判定"——车间需要它在服务端被批量、可审计、可回溯地执行。现在它只在用户打开浏览器、加载模型、点按钮时才存在，服务端和任何自动化流程都拿不到。

2. **共享契约层是空壳**
   `shared/domain/printability.ts` 只有 25 行类型。这意味着前后端之间没有稳定的判定契约，任何服务端接入都得自己重新定义一遍输出结构——正是这次需要显式设计 `AnalyzeResult` 的原因。

3. **下游一切依赖一个不存在的"判定服务"**
   车间层要做"进机前拦截"，MCP 要做"agent 调用判定"，都建立在"判定可以不下浏览器地被调用"这个前提上。这个前提现在不成立。

### 3.2 三步的依赖关系

```
① 判定层下沉（服务端可调用、契约稳定）
        ↓ 提供可复用的判定能力
② 车间数据模型（job / machine / 执行记录，先不接设备）
        ↓ 提供可被查询的业务对象
③ MCP 出口（把 ①② 暴露给 agent）
```

任何一步跳过前序，产出的都是空壳。

---

## 四、第一步：判定层下沉（已落地可用切片）

### 4.1 交付内容

| 文件 | 作用 |
|---|---|
| `server/analyzeService.ts` | 服务端判定入口：STL 字节 → GeometryModel → 统一分析 → 结构化缺陷清单。**不重新实现任何规则**，全部调用 `client/src/analysis` 既有模块，保证与前端结论同源 |
| `server/analyzeRouter.ts` | `POST /api/analyze`（raw 字节或 base64 JSON）、`GET /api/analyze/health` |
| `server/analyzeService.test.ts` | 13 项断言，覆盖判定正确性、输入鲁棒性、HTTP 往返 |
| `server/index.ts` | 挂载 `/api/analyze`，置于 `bridgesEnabled` 分支**之外**（纯进程内计算，不需 BRIDGE_TOKEN、不执行宿主代码） |

### 4.2 输出契约

```ts
interface AnalyzeResult {
  modelFileName: string;
  analyzedAt: string;          // ISO 时间戳，可审计
  overallConfidence: number;
  topologyProfile: string | null;
  summary: {                   // 客观测量值
    bboxMm, volumeMm3, surfaceAreaMm2,
    minWallThicknessMm, avgWallThicknessMm,
    isWatertight, holeCount, boundaryEdgeCount, flippedNormalRatio,
    fitsBuildVolume,
    estimatedPrintTimeMinutes, estimatedSupportGrams, supportDifficulty,
    printTimeSource
  };
  gate: { status: 'clean' | 'warning' | 'fail'; criticalCount; warningCount; infoCount };
  findings: Finding[];         // 具体缺陷条目，含 moduleSource 可溯源
  elapsedMs: number;
}
```

**`gate` 与前端 `ExecutiveSummary.verdict` 是两套命名、两套语义，刻意不合并。**
`gate` 是服务端的聚合口径：存在 critical → `fail`；仅 warning → `warning`；否则 `clean`。
它不替代前端面向用户的总体评分，只用于"能否进入下一道工序"这类硬门槛判断。两者混用会导致同一模型出现两个互相矛盾的结论。

### 4.3 验证证据（全部为实测结果）

**判定正确性**（真实 STL fixture）：

| 样本 | 尺寸 | 判定输出 | 是否合理 |
|---|---|---|---|
| `t_cube20` | 20³ mm | watertight=true, gate=clean, 无 finding | ✅ |
| `t_openbox` | 20³ mm 开口 | watertight=false, holeCount=1, gate=fail, critical「模型不防水」 | ✅ |
| `t_big300` | 300³ mm | fitsBuildVolume=false, gate=fail, critical「模型超出打印床」+ info「成本较高」 | ✅ |
| `t_thinwall05` | 0.5mm 薄壁 | minWall=0.5, gate=warning, warning「壁厚过薄」 | ✅ |
| `test_model` | 10×6×2 mm | holeCount=37, gate=fail（不水密 + 薄壁 + 支撑复杂） | ✅ |
| `test_cube` | 1³ mm | gate=fail（不水密 + 法线方向错误） | ✅ |

**性能**：单模型判定 0.8–25ms（`test_model` 最复杂 25ms，`t_cube20` 1.3ms）。

**端到端**（真实服务 `PORT=39417 tsx server/index.ts` + `curl`）：

```
POST /api/analyze   ← t_cube20.stl (raw, X-Model-Filename: cube20.stl)
{"modelFileName":"cube20.stl","overallConfidence":0.4,
 "summary":{"bboxMm":{"x":20,"y":20,"z":20},"volumeMm3":8000,"surfaceAreaMm2":2400,
 "minWallThicknessMm":20,"isWatertight":true,"fitsBuildVolume":true,
 "estimatedPrintTimeMinutes":22,"supportDifficulty":"none"},
 "gate":{"status":"clean","criticalCount":0,"warningCount":0,"infoCount":0},
 "elapsedMs":8.64}
```

**13/13 通过**，含：raw/octet-stream 200、请求头取文件名、JSON base64 等价、无载荷 400、非法 STL 422（不是 500）、health、以及 **Node 池化 Buffer 非零 byteOffset（5000）正确解析**。

### 4.4 工程校验

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（strict） | **0 错误**（全仓库） |
| `esbuild --bundle server/index.ts` | 成功产出 4.6MB cjs |
| `vitest run` | **无法启动**：本机 `@rollup/rollup-darwin-arm64` 原生模块代码签名失效（`mapping process and mapped file have different Team IDs`）。既有测试同样失败，属环境问题，非本次改动引入。故改用 tsx 直跑等价验证 |

### 4.5 尚未完成（诚实标注）

- ❌ 前端尚未改为调用 `/api/analyze`，浏览器内 Worker 判定路径**仍然存在且仍是主路径**。当前是"新增了一条并行通道"，不是"已经迁移"。
- ❌ 判定结果尚未持久化，无分析历史。
- ❌ `shared/domain/printability.ts` 契约层仍未充实，`AnalyzeResult` 目前定义在 `server/` 内，未来应上移到 `shared/`。
- ⚠️ 服务端 bundle 因间接引入 `three.js`（`parseSTL` 返回 `BufferGeometry`）增至 4.6MB。功能正确，但属可优化项：长远应提供不依赖 three 的 STL → GeometryModel 直转路径。

---

## 五、第二步与第三步（待启动）

### 第二步：车间数据模型（不接设备）

建 `job` / `machine` / `execution` 三类对象，先不连任何真实设备，用本地 JSON 或既有存储落地。目的是让判定结果有地方挂——一次判定必须能归属于某个 job、某台机器、某个时刻。

关键设计约束：机台能力（成形尺寸、工艺类型、材料）必须成为**判定的输入**，而不是事后过滤。当前 `bedFit` 用的是硬编码打印床假设，第二步需要把它改为读取机台配置。

### 第三步：MCP 出口

在前两步完成后，把「提交模型 → 得到判定」和「查询 job/机台状态」暴露为 MCP 工具。此时出口才有实质内容，而不是包一层空壳。

---

## 六、未决事项

| 事项 | 状态 |
|---|---|
| 在途 4 处改动（bridge-e2e 相关） | 已 `git stash` 保存为 `stash@{0}`，并额外备份至会话 temp `wip-backup/`。需要决定：合并回原分支运行，还是废弃重做 |
| 分支策略 | 本工作全部在 `feat/verdict-downshift`，未 push、未触碰 `main` |
| 判定契约归属 | `AnalyzeResult` 是否上移 `shared/domain/printability.ts` |
| three.js 依赖 | 是否提供无 three 的 STL 解析路径以压缩服务端体积 |
| vitest 环境 | 本机 rollup 原生模块签名需修复（`pnpm rebuild` 或重装 `node_modules`），否则所有测试无法运行 |
*（内容由AI生成，仅供参考）*
