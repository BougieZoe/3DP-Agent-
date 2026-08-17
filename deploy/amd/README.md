# deploy/amd — ROCm 深度集成工具包

覆盖 L1（部署/验证）、L2（数据管道/采集）的工具。

## 文件

| 文件 | 用途 | 在哪跑 |
|------|------|--------|
| `vllm-serve.sh` | MI300X 上起 vLLM（prefix caching + 统一模型名 + 显存预算） | AMD 实例上 |
| `verify.sh` | 开实例后一键验证：模型名 / prefix cache / 端到端延迟 / GPU 状态 | 能连到实例的机器 |
| `capture-traces.ts` | 命令行批量采集 agent 流水线 trace（不用开浏览器） | 本地，需 dev server + key |
| `build-dataset.py` | metrics.jsonl → prompt 池；agent-traces.jsonl → 训练集 | 本地 |
| `agent-traces.jsonl` | （生成物）agent 流水线的真实 I/O | 本地 |

## 开实例后的流程

```bash
# 1. 在 AMD 实例上起 vLLM（默认 Qwen/Qwen3-30B-A3B）
./deploy/amd/vllm-serve.sh

# 2. 本地/隧道验证（ssh -L 8000:localhost:8000 ...）
./deploy/amd/verify.sh http://localhost:8000
# 记下输出的数字 —— 这就是 case study 的 MI300X benchmark 章节素材
```

## 采集 agent 训练数据

### 方式 A：浏览器自动采集（已在 main，零操作）

每次深度分析，5 个 agent 步骤自动 POST 到 `/api/agent-trace`（dev bridges），追加进 `agent-traces.jsonl`。跑几次真实分析即可。

### 方式 B：命令行批量采集（本文件）

```bash
# 本地 server 起着（3001），提供任意 keyed provider 的 key
CAPTURE_API_KEY=sk-... npx tsx deploy/amd/capture-traces.ts --rounds 5
CAPTURE_API_KEY=sk-... CAPTURE_BASE_URL=http://localhost:3001 \
  npx tsx deploy/amd/capture-traces.ts --rounds 5 --provider deepseek
```

每次 round 用不同的模型数据变体（壁厚/悬空/水密各异），含 critic 重试的完整轨迹。约 5 轮 ≈ 30+ 条 trace。

### 转训练集

```bash
python3 deploy/amd/build-dataset.py   # -> train.jsonl（alpaca 格式，LLaMA-Factory 兼容）
```

## 微调（有实例时）

LLaMA-Factory（ROCm 原生支持）：

```bash
git clone https://github.com/hiyouga/LLaMA-Factory
cd LLaMA-Factory
pip install -e .[torch,metrics]        # ROCm 版 PyTorch 需先装好
llamafactory-cli train \
  --model_name_or_path Qwen/Qwen3-8B \
  --dataset 3dp_train \
  --template qwen \
  --finetuning_type lora \
  --output_dir ./3dp-qwen3-8b-lora
```

产物加载回 vLLM：`vllm serve ... --enable-lora --lora-modules 3dp=./3dp-qwen3-8b-lora`——推理闭环。

## 注意

- `HSA_OVERRIDE_GFX_VERSION` 默认不设（MI300X = gfx942，ROCm 6.x 原生支持）；驱动不认卡时再开
- prefix caching 在你的架构里命中 critic 重试和固定 prompt，跨 agent 不命中——verify.sh 第 2 步会给你真实证据
- AMD 路径目前被排除在 deep analysis 之外（`deepAnalysis.ts` 的 provider 检查）；等实例在线后解锁
- 所有数字都要真实：verify.sh 跑出来的就是你的 benchmark，别编
