# 3DP Agent × AMD ROCm 深度集成方案

**目标**：把当前"AMD = 远程 OpenAI 兼容端点"（L0）升级为"ROCm 栈的深度使用者"。每一层都可独立落地、可验证、可写进 case study 和求职叙事。

**现状（L0）**：浏览器 → serverless 代理 → vLLM（OpenAI 兼容 API）。MI300X 被当黑盒，换成任何云 GPU 代码零改动。5-agent 流水线本身扎实（串行上下文 + 2 个 critic checkpoint），但对 ROCm 的利用停留在"能响应"。

---

## L1：vLLM on ROCm 部署姿势（服务端配置，应用层零改动）

**这是"ROCm 深度使用"的第一块实锤：会配 vLLM on MI300X 和会调 OpenAI 兼容 API 是两个段位。**

### 1.1 启动参数包（写进部署脚本，开实例即用）

```
vllm serve Qwen/Qwen3-30B-A3B \
  --served-model-name qwen3-30b-a3b \        # 统一模型名，根治"两种写法"的坑
  --enable-prefix-caching \                  # 见 1.2 的命中分析
  --gpu-memory-utilization 0.90 \
  --max-model-len 16384 \                    # 5-agent 串行上下文预算
  --trust-remote-code
```

环境变量（写进 systemd/docker 配置）：

```
HSA_OVERRIDE_GFX_VERSION=11.0.0   # 驱动-卡不匹配时的逃生舱（视驱动版本而定）
ROCR_VISIBLE_DEVICES=0            # 显式指定可见 GPU
```

### 1.2 Prefix caching 的真实命中分析（诚实版）

**会命中**：
- critic 重试——`callAgentWithCritic` 重试时同一 prompt + 追加 feedback，前缀完全一致（Geometry 与 Scorer 两个 checkpoint）
- orchestrator 摘要——prompt 结构固定
- 多用户同时分析时，相同的 Design Starter / system prompt 前缀

**不会命中**：跨 agent 的共享上下文（Geometry 输出嵌在各自不同的 system prompt 之后，前缀不同）。别听人吹"5-agent 天然吃满 prefix cache"——你的架构里它只在重试和固定 prompt 场景生效，收益真实但有限。

**更大的 token 优化在同层**：agent 输出是 JSON，但 agent 2/3/4 的 prompt 里反复嵌入 `geoResult.raw`（完整 JSON）。改成只传关键字段（壁厚、悬空面数、watertight），单次分析可省几百 token × 4 次传递。

### 1.3 验证脚本（开实例后一键跑）

```
1. GET /v1/models            → 确认模型名（根治坑 7）
2. 同一 prompt 连调 5 次      → 测第 1 次 vs 后 4 次的 prefill 耗时差（cache 命中证据）
3. 5-agent 流水线跑一轮      → 记录端到端耗时
4. rocprof --stats 采样一轮  → TTFT / decode 吞吐 / 显存占用
```

产出：**第一批真实 MI300X 性能数字**——直接补进 case study，替换掉 "No invented benchmarks" 的软肋声明。

---

## L2：领域化（把算力变成别人拿不走的资产）

**这是"用 ROCm 跑出价值"的最终定义：训练和推理都在 AMD 上，产出领域模型。**

### 2.1 数据管道（不需要实例，现在就能开始）

数据源（现有）：
- `.cad-bridge/metrics.jsonl`（92 条 CAD 生成记录：prompt + 成败）
- agent 流水线的真实输出（Geometry/Failure/Optimization/Score 的 JSON）

清洗脚本（待写）：
```
metrics.jsonl + agent 输出 → (instruction, response) 对 → JSONL 训练集
```

### 2.2 微调（需要实例）

- 工具：LLaMA-Factory / axolotl（都原生支持 ROCm）
- 基座：Qwen3-8B（比 30B 便宜，够 3D 打印领域用）
- 方法：LoRA（单卡 MI300X 192GB 绰绰有余）
- 产出：`3dp-qwen3-8b-lora`——推理回到 vLLM 加载 LoRA，闭环完成

### 2.3 叙事价值

"推理在 AMD、训练在 AMD、产出领域模型"——这不是调 API，这是把 ROCm 当平台用。DevRel 和面试官都能一眼看出深度差异。

---

## L3：可观测（补 case study 的软肋）

- vLLM 自带 Prometheus metrics（`/metrics`）：TTFT、decode 吞吐、cache hit 率
- rocprof：kernel 级剖析（可选，进阶）
- 一次采集，终身复用：写进 case study 的 benchmark 章节 + 求职面试的性能数据

---

## 应用层配合（小改动，配合 L1/L2）

1. **模型名自动化**：`callAI` 的 amd-cloud 分支加 `GET /v1/models` 探测，自动拿模型名——根治坑 7，不再硬编码
2. **上下文压缩**：agent 间传递结构化字段而非完整 JSON（配合 1.2 的 token 优化）
3. **代理层**：模型白名单从服务端配置读（已实现），模型名参数化（小改）

---

## 投入产出表

| 层级 | 需要实例 | 投入 | 产出 | 求职/叙事价值 |
|------|---------|------|------|--------------|
| L1 配置包 | 是（验证） | 1-2 天 | 真实性能数字 + 部署脚本 | 高：MI300X 一手数据 |
| L1 token 优化 | 否（先写） | 半天 | 延迟/成本下降 | 中：工程细节 |
| L2 数据管道 | 否 | 1 天 | 训练集 | 高：微调闭环第一步 |
| L2 LoRA 微调 | 是 | 2-3 天 | 领域模型 | 最高：AMD 上训练 |
| L3 可观测 | 是 | 半天 | benchmark 数据 | 高：文章升级 |

---

## 建议路径

**先做 L2 数据管道（不需要实例，今天就能开始）+ L1 配置包（写好等你开实例）**。你开实例那天，跑验证脚本 → 拿到性能数字 → case study 加 benchmark 章节 → 然后 LoRA 微调。

要我直接开写哪个？我建议从 **L1 配置包 + 验证脚本** 开始（代码全写好，你开实例即用），数据管道随后。
