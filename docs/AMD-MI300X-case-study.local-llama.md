# r/LocalLLaMA 帖子 — 修正版（最终）

**标题：**
MI300X + vLLM + Qwen3-30B-A3B: 7 issues fixed, 0 ROCm failures

**正文：**

I spent a week running a 5-agent LLM pipeline on an AMD MI300X (hackathon instance, ROCm + vLLM serving Qwen). Full writeup: https://gist.github.com/BougieZoe/1eeb17da560f48163d4a089008e6b520

The surprising part: I fixed seven real issues that week, and none of them were ROCm failures. Every single one was boring infrastructure — ephemeral instance IPs, HTTPS/HTTP mixed content, CORS, serverless timeouts, a proxy that swallowed status codes. That changed my opinion of ROCm more than any benchmark could have.

Unlike a chatbot wrapper, this is a sequential 5-agent workflow: geometry analysis → printability scoring → failure prediction → optimization advice → consensus. Each stage consumes the previous stage's *structured JSON output* as its context, with a critic checkpoint + retry on the two highest-risk stages. So it's 5 serial LLM calls per analysis, not 1.

Quick facts:

- Models: Qwen3-30B-A3B primary; Qwen3-8B when the instance's VRAM (48GB notebook) couldn't fit the 30B. Both via vLLM on ROCm.
- The architecture is provider-agnostic — one OpenAI-compatible contract, AMD as a first-class provider next to OpenAI/DeepSeek. Swapping the backend is a config change, not a refactor.
- Honest caveat: no benchmark numbers (tokens/s, TTFT) — I was shipping, not benchmarking, and I won't invent numbers. What I can say: not a single ROCm/hardware failure all week.
- Quirk worth knowing: the two Qwen models needed different name formats (namespaced vs bare) depending on which instance proxy you hit. Put model names in config, not code.

Questions for people with MI300X/ROCm production experience:

1. Anyone else running vLLM on MI300X long-term? Stability compared to my "zero hardware failures in a week"?
2. Qwen3-30B-A3B is MoE — for serial multi-agent calls (5 in a row, ~1-2k tokens each), any KV cache / memory fragmentation issues? I didn't see any, but my sessions were modest.
3. vLLM, SGLang, or something else for ROCm serving these days?

Links:

- Writeup (all commits + architecture): https://gist.github.com/BougieZoe/1eeb17da560f48163d4a089008e6b520
- Repo: https://github.com/BougieZoe/3DP-Agent-
- Hackathon submission: https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii/aetherforge/3dp-agent-multi-agent-stl-analysis-for-amd-rocm
- Live app: https://3dp-agent.vercel.app/
