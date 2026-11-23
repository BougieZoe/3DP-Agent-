---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 60511e479f736a9399334d56570e10ac_ac1f52f9e6f211f184bd52540072b1e8
    ReservedCode1: DgSq3JmAo1+XaPM9wR37VYOmeKyvKDwDqsBsGlw9Vd9rojoMCWbE4lGKtSRg8s/G3aGZz5ROseXKAm1TAcQF1bKBrWhDtCsH1xUPODhDLg5wUBsjeaAEd9pvEmGVpkAKWTwZj3d/g7w872B8goHE47AzhNWVomyyNgzaRk+yU2hZYkcrH2Yv4vqsozw=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 60511e479f736a9399334d56570e10ac_ac1f52f9e6f211f184bd52540072b1e8
    ReservedCode2: DgSq3JmAo1+XaPM9wR37VYOmeKyvKDwDqsBsGlw9Vd9rojoMCWbE4lGKtSRg8s/G3aGZz5ROseXKAm1TAcQF1bKBrWhDtCsH1xUPODhDLg5wUBsjeaAEd9pvEmGVpkAKWTwZj3d/g7w872B8goHE47AzhNWVomyyNgzaRk+yU2hZYkcrH2Yv4vqsozw=
---

# 车间数据模型：五层机器数据合并为单一真源

状态：已实现（`feat/shopfloor-model`）
日期：2026-11-23
基线：`main` @ 20509a97

## 1. 问题：机器/床型数据分裂在五层

开工前，同一批机器的尺寸分散在五个互不引用、可各自漂移的位置：

| 层 | 位置 | 内容 | 问题 |
| --- | --- | --- | --- |
| 1 | `client/src/analysis/bedFit.ts` | `PRINTER_PROFILES`（6 机型，含 FGF 1800/1200） | 床型判定真源，硬编码尺寸 |
| 2 | `client/src/analysis/types.ts` | `PrinterBedProfile` | 层 1 的类型副本 |
| 3 | `client/src/lib/printFarm.ts` | `PrinterCapabilities.maxBuildVolume` | 机台尺寸再次硬编码，与机型无外键 |
| 4 | `client/src/lib/manufacturingRecommendation.ts` | `PROCESSES[].buildVol` | 工艺级包络，FGF 又抄一遍 1800×1200×1300 |
| 5 | `server/data/machines/*.json` | 供应商档案 | `large-format-fgf.json` 无尺寸字段，todo 注明"尺寸未确认" |

本质缺失是**机台实例层**：数据从工艺直接跳到机器，没有"某台具体机器"这一层，因此状态、位置、维护、排产都无处安放。`printFarm.ts` 的 `Printer` 接口有 `status`/`lastSeen`，却没有任何字段指向它属于哪个机型。

## 2. 处理：三层真源 + 一份档案

新增 `shared/domain/machine.ts`，作为 client 与 server 共用的唯一真源：

```
工艺工艺包络 PROCESS_ENVELOPES  (FDM / FGF / SLA / SLS / PBF)
        ↓ representativeModelId
机型 MACHINE_MODELS             (尺寸 + 验证状态 + 出处)
        ↓ modelId
机台实例 MACHINE_UNITS          (状态 / 位置 / 维护 / 物料)
```

关键设计：**尺寸与可信度绑定**。`MachineModel.buildVolume` 允许为 `null`，此时 `buildVolumeVerification` 必须为 `'unverified'`。取尺寸有两个入口：

- `requireBuildVolume(id)` — 抛错，禁止任何"猜一个差不多的尺寸"的降级路径；
- `tryBuildVolume(id)` — 返回 `null`，供 UI 走"尺寸待确认"分支。

### 2.1 large-format-fgf.json 的处理

该档案明确写着成型尺寸未确认。处理方式是不填：

```ts
'large-format-fgf': {
  buildVolume: null,
  buildVolumeVerification: 'unverified',
  source: 'server/data/machines/large-format-fgf.json — 6.1 节记录 1800×1200×1300 为家族标称值，'
        + '本档位具体机型未确认，故不填尺寸',
}
```

它不会出现在 `PRINTER_PROFILES` 里，因为那不是一台可选床型。工艺包络 `FGF` 也不从它派生，而是从有双源佐证的 `fgf_1800_pro` 派生。

### 2.2 档案 id 必须与真源 key 一致

真源键使用供应商档案的 `id`（如 `large-format-fgf`），不另起一套命名。早期曾把文件名写成供应商真名、而 `id` 另起 `large-format-fgf-generic`，两者对不上，导致
`server/__tests__/machineProfiles.test.ts` 的交叉校验 `getMachineModel(p.id)` 取不到对应条目——而当时本机 vitest 无法启动，
这条校验从未真正执行过。现已改为与档案 id 同名，并把交叉校验纳入 esbuild 实测路径。

### 2.3 尺寸出处

| 机型 | 尺寸 (mm) | 验证状态 | 出处 |
| --- | --- | --- | --- |
| `fgf_1800_pro` | 1800 × 1200 × 1300 | `verified` | `types.ts` 与 `manufacturingRecommendation.ts` 两处独立记载一致，双源互证 |
| `fgf_1200` | 1200 × 800 × 1000 | `single-source` | 仅 `bedFit.ts` 一处记载，无第二来源 |
| `bambu_x1c` | 256 × 256 × 256 | `verified` | 公开机型参数，与 `printFarm.ts` 记载一致 |
| `prusa_mk4` | 250 × 210 × 220 | `verified` | 公开机型参数 |
| `creality_k1` | 220 × 220 × 250 | `verified` | 公开机型参数 |
| `ender_3` | 220 × 220 × 250 | `verified` | 公开机型参数 |
| `formlabs_form3` | 145 × 145 × 185 | `verified` | 公开机型参数 |
| `large-format-fgf` | `null` | `unverified` | 大幅面颗粒料 FGF 品类档案（供应商匿名化），成型尺寸未经确认 |

`verified` / `single-source` / `unverified` 的区别是有意保留的：`fgf_1200` 只有一个内部来源，与公开机型参数的可信度不同，不应混为一谈。

## 3. 顺带修掉的 bedFit 缺陷

原 `bedFit.ts` 的轴映射：

```ts
const fitsY = rotatedSize.z <= profile.heightMm;  // 用 z 比 height
const fitsZ = rotatedSize.z <= profile.depthMm;   // 又用 z 比 depth
```

`y` 从未与 `depthMm` 比较，depth 约束实际失效，而下方输出的 `clearanceMm.y` 用的是正确轴——判定与解释互相矛盾。

修复为 `fitsY = rotatedSize.y <= profile.depthMm`、`fitsZ = rotatedSize.z <= profile.heightMm`。

回归证据：`(2000, 1300, 100)` 在 FGF 1800 Pro 上，旧代码经 `rotateZ_90` 得到 `(1300, 2000, 100)`，因 y 与 depth 都拿到 `z=100` 而误判可放；修复后判不可放。

注意测试构造：旋转候选会救回单轴超限（如 1201 立起来走 height）。判断"放不下"必须构造任何朝向都无解的形状——对 FGF（最紧的是 depth 1200），排序后三维 `s1≤s2≤s3` 可放当且仅当 `s1≤1200 && s2≤1300 && s3≤1800`。

## 4. 变更清单

| 文件 | 变更 |
| --- | --- |
| `shared/domain/machine.ts` | 新增：三层真源与查询函数 |
| `client/src/analysis/types.ts` | `PRINTER_PROFILES` 改为从真源投影，删除硬编码尺寸 |
| `client/src/analysis/bedFit.ts` | 修复 y/z 轴映射 |
| `client/src/lib/manufacturingRecommendation.ts` | FGF `buildVol` 改为从 `PROCESS_ENVELOPES` 派生 |
| `client/src/analysis/__tests__/bedFitAxes.test.ts` | 新增：三轴回归 |
| `shared/domain/__tests__/machine.test.ts` | 新增：真源契约、排产、投影一致性 |
| `server/__tests__/machineProfiles.test.ts` | 扩充：供应商档案与真源交叉校验 |

`client/src/lib/vendorCapacity.json` 保持原样（只含状态与物料，不含尺寸），由测试锁住机台 id 与 `MACHINE_UNITS` 双向一致。

## 5. 验证

- `tsc --noEmit`：0 错误
- 行为验证：44 项断言全部通过（三轴判定 14 项、真源契约 15 项、投影一致性 7 项、产能对齐 2 项、供应商档案交叉校验 6 项）
- 本机 `vitest` 因 rollup 原生模块签名失效无法启动（`ERR_DLOPEN_FAILED`，与设备既有问题一致），故用 esbuild 打包后由 node 执行真实源码路径完成验证；vitest 用例已同语义写好，供正常环境与 CI 执行。

## 6. 未做与后续

- `printFarm.ts` 的 `Printer` 接口尚未加 `modelId` 外键，机台列表仍走自己的 `getPrinters()`。下一步应让它指向 `MACHINE_UNITS`，把状态真源收敛到一处。
- `MACHINE_UNITS` 的 `location` / `lastMaintenanceAt` 全部为 `null`，等待真实车间位置录入，未编造。
- 工艺包络 `SLS` / `PBF` 无仓库内依据，留 `null`。

## 7. 判定策略版本与校准层登记

同名字东西太多会漂移。这一节是唯一登记处：新增一层校准、或改一次判定策略版本，都先在这里落一行，再动代码。

### 7.1 判定策略版本（`policyVersion`）

真源：`shared/domain/verdictPolicy.ts`。除该文件外**任何文件不得书写版本字面量**，包括测试——测试里手打的版本号一旦与引擎不一致，pin 会静默匹配不到任何记录，空看板会被读成"没有缺陷"，这是本项目最贵的错误。

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `VERDICT_POLICY_VERSION` | `wall-2026-11-23a` | 当前引擎给新判定盖章的版本；看板默认 pin 到它 |
| `LEGACY_PYTHON_POLICY_VERSION` | `py-wall-2026-11-20a` | Python 原型写下的历史版本，仅用于区分历史记录，禁止 pin 到它出当前比率 |
| `isCurrentPolicy(v)` | — | 判断某条记录是否属当前策略 |

约定：

1. 改策略 → 改常量 → 在本节补一行变更理由 → 历史记录**保持原版本不动**，不追认改写。
2. 手工筛选与用 scope pin 必须得出同一个看板（已由测试锁住）。
3. pin 之后被排除的记录**必须计数并展示**（`YieldScoreboard.excludedByVersion`，面板文案"另有 N 条属旧策略未计入"）。空分母与零缺陷在页面上不能长得一样。
   其中**未盖章**的记录（`policyVersion` 为空，多是旧 verdict 或漏盖章的引擎）单独计入 `unstamped`，不许并进"旧策略"里——迁移欠账和盖章漏洞是两种病，混成一个数就再也查不出后者。

| 版本 | 起始 | 说明 |
| --- | --- | --- |
| `py-wall-2026-11-20a` | 2026-11-20 | Python 原型期策略，仅存于历史记录 |
| `wall-2026-11-23a` | 2026-11-23 | 当前策略；良率看板与其假通过/误拦截分向率的生效基线 |

已知的历史拼写漂移：早期演示数据曾用 `py-wall-2026-11-23a` 给记录盖章，与当时的引擎常量 `wall-2026-11-23a` 差一个前缀，pin 后一条也匹配不到，看板直接空掉——这正是本节存在的理由。该类记录不会被追认改写，而是计入 `excludedByVersion` 显示为"旧策略未计入"，面板上看得到版本串，不静默。

### 7.2 校准层分工（两个同名 `calibration` 已按层改名）

两套东西都叫 calibration，读代码时无法分辨是哪一层。现按"证据从哪来"改名：

| 文件 | 层 | 输入 → 输出 | 当年叫 |
| --- | --- | --- | --- |
| `shared/domain/fieldCalibration.ts` | 现场实测层（domain） | 机台实测读数 → 收窄后的工艺包络、证据等级 | `shared/domain/calibration.ts` |
| `client/src/lib/loopWeightFit.ts` | 打分拟合层（client） | 几何特征 + 打印结局 → 待拟合的 LOOP 权重样本 | `client/src/lib/loopCalibration.ts` |

判据：**包络变窄**属于 `fieldCalibration`；**改权重/分数**属于 `loopWeightFit`。前者有硬规则（单台不可改型谱、校准只收窄不收宽），后者只是待拟合样本，本地留存、未拟合前不生效。

*（内容由AI生成，仅供参考）*
