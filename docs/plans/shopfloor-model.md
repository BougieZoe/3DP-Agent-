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
| 5 | `server/data/machines/*.json` | 供应商档案 | `hanevex-fgf.json` 无尺寸字段，todo 注明"尺寸未确认" |

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

### 2.1 hanevex-fgf.json 的处理

该档案明确写着成型尺寸未确认。处理方式是不填：

```ts
'large-format-fgf-generic': {
  buildVolume: null,
  buildVolumeVerification: 'unverified',
  source: 'server/data/machines/hanevex-fgf.json — 6.1 节记录 1800×1200×1300 为家族标称值，'
        + '本档位具体机型未确认，故不填尺寸',
}
```

它不会出现在 `PRINTER_PROFILES` 里，因为那不是一台可选床型。工艺包络 `FGF` 也不从它派生，而是从有双源佐证的 `fgf_1800_pro` 派生。

### 2.2 尺寸出处

| 机型 | 尺寸 (mm) | 验证状态 | 出处 |
| --- | --- | --- | --- |
| `fgf_1800_pro` | 1800 × 1200 × 1300 | `verified` | `types.ts` 与 `manufacturingRecommendation.ts` 两处独立记载一致，双源互证 |
| `fgf_1200` | 1200 × 800 × 1000 | `single-source` | 仅 `bedFit.ts` 一处记载，无第二来源 |
| `bambu_x1c` | 256 × 256 × 256 | `verified` | 公开机型参数，与 `printFarm.ts` 记载一致 |
| `prusa_mk4` | 250 × 210 × 220 | `verified` | 公开机型参数 |
| `creality_k1` | 220 × 220 × 250 | `verified` | 公开机型参数 |
| `ender_3` | 220 × 220 × 250 | `verified` | 公开机型参数 |
| `formlabs_form3` | 145 × 145 × 185 | `verified` | 公开机型参数 |
| `large-format-fgf-generic` | `null` | `unverified` | 供应商档案未确认 |

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
- 行为验证：36 项断言全部通过（三轴判定 14 项、真源契约 15 项、投影一致性 7 项）
- 本机 `vitest` 因 rollup 原生模块签名失效无法启动（`ERR_DLOPEN_FAILED`，与设备既有问题一致），故用 esbuild 打包后由 node 执行真实源码路径完成验证；vitest 用例已同语义写好，供正常环境与 CI 执行。

## 6. 未做与后续

- `printFarm.ts` 的 `Printer` 接口尚未加 `modelId` 外键，机台列表仍走自己的 `getPrinters()`。下一步应让它指向 `MACHINE_UNITS`，把状态真源收敛到一处。
- `MACHINE_UNITS` 的 `location` / `lastMaintenanceAt` 全部为 `null`，等待真实车间位置录入，未编造。
- 工艺包络 `SLS` / `PBF` 无仓库内依据，留 `null`。
