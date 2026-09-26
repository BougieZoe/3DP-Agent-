# MI300X Benchmark Section — Draft for the Case Study

> 占位骨架。开 AMD 实例跑 `deploy/amd/verify.sh` 后，把真实数字填进下面的 [ ]。**所有数字必须来自真实运行，不编。**

## 环境

- 实例：AMD Developer Cloud（MI300X / gfx942）
- 推理服务：vLLM（ROCm 后端）
- 模型：Qwen3-8B（48GB 实例）或 Qwen3-30B-A3B（192GB 实例）
- 客户端：本机 → serverless 代理 → 实例
- 日期：[ ]（例：2026-08-xx）
- vLLM 版本 / ROCm 版本：[ ]

## 硬件

- GPU：AMD Instinct MI300X
- 显存：192 GB HBM3
- rocm-smi 读数（温度/利用率/VRAM）：[ ]

## 延迟（verify.sh 输出）

### Prefix cache 探针（同 prompt × 5）

| 调用 | 端到端耗时 (s) |
|------|---------------|
| 1（冷） | [ ] |
| 2 | [ ] |
| 3 | [ ] |
| 4 | [ ] |
| 5 | [ ] |

> 结论：调用 2-5 与调用 1 的耗时差 = prefix caching 的真实收益。[填写观察]

### 端到端 agent 风格调用（3DP prompt，max_tokens 512）

- 耗时：[ ] s

## 5-Agent 流水线（真实运行）

- 模型：[ ]
- 单次完整分析：5 步 + [ ] 次 critic 重试
- 端到端耗时：[ ] s
- 总输出 token：[ ]（可从 vLLM 日志 / usage 字段统计）
- KV cache 命中：[ ]（vLLM `/metrics` 的 `vllm:prefix_cache_hit_rate`）

## 对比基准（如有）

- 同 prompt 在 [其他服务] 上的耗时：[ ]（仅当有真实测量才填）

---

**写法提示**：数字到手后，这段放进 case study 主文（Section 5/6 之间或文末附录），标题建议 *"Appendix: measured on an MI300X"*——真实的数字 + 诚实的测量方法，比任何修辞都硬。
