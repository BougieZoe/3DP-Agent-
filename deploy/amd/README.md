# deploy/amd — ROCm 深度集成工具包

三个文件，覆盖 L1（部署/验证）和 L2（数据管道）的第一步。

## 文件

| 文件 | 用途 | 在哪跑 |
|------|------|--------|
| `vllm-serve.sh` | MI300X 上起 vLLM（prefix caching + 统一模型名 + 显存预算） | AMD 实例上 |
| `verify.sh` | 开实例后一键验证：模型名 / prefix cache / 端到端延迟 / GPU 状态 | 能连到实例的机器 |
| `build-dataset.py` | 从 metrics.jsonl 提取 prompt 池；把 agent 输出转训练集 | 本地 |
| `agent-traces.jsonl` | （生成物）agent 流水线的真实 I/O，喂给 build-dataset.py | 本地 |

## 开实例后的流程

```bash
# 1. 在 AMD 实例上起 vLLM（默认 Qwen/Qwen3-30B-A3B）
./deploy/amd/vllm-serve.sh

# 2. 本地/隧道验证（ssh -L 8000:localhost:8000 ...）
./deploy/amd/verify.sh http://localhost:8000
# 记下输出的数字 —— 这就是 case study 的 MI300X benchmark 章节素材
```

## 采集 agent 训练数据（L2 前置）

`build-dataset.py` 目前只产出了 prompt 池（29 条），训练集需要真实的 agent I/O。最小改法——给 `client/src/lib/agentPipeline.ts` 的 `callAgent()` 加一个可选 trace 钩子：

```ts
async function callAgent(
  systemPrompt: string,
  userContext: string,
  language?: string,
  signal?: AbortSignal,
  trace?: (t: { agent: string; systemPrompt: string; userContext: string; raw: string }) => void,
): Promise<AgentStepResult> {
  // ...现有逻辑...
  const raw = await callAI(provider, apiKey, systemPrompt, userContext, language, signal);
  trace?.({ agent: systemPrompt.slice(0, 30), systemPrompt, userContext, raw });
  // ...
}
```

调用处（`runAgentPipeline` 入口）加一个可选参数往 `deploy/amd/agent-traces.jsonl` 落盘：

```ts
export async function runAgentPipeline(..., trace?: (t: unknown) => void) {
  // 每个 callAgent 调用后 trace?.(...)
}
```

采集几轮真实分析后：

```bash
python3 deploy/amd/build-dataset.py   # -> train.jsonl（alpaca 格式）
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
- 所有数字都要真实：verify.sh 跑出来的就是你的 benchmark，别编
