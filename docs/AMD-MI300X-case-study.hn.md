# I moved production LLM inference to AMD MI300X — 7 fixes in a week

**A deployment retrospective from the AMD Developer Hackathon: ACT II. Wiring a real product's five-agent LLM pipeline onto AMD Instinct MI300X (ROCm + vLLM).**

> Every fact is traceable: git commits, PR records, code comments, and the project submission. No invented benchmarks.

---

## The submission

3DP Agent is a browser-based tool that analyzes 3D print files before they reach a printer — wall thickness, overhang severity, printability score, failure modes, optimization advice. The core is a five-agent pipeline (Geometry Analyst → Printability Scorer → Failure Predictor → Optimization Advisor → orchestrator consensus), implemented as one function calling the LLM five times in sequence, swapping the system prompt and feeding each step's JSON output into the next.

Inference runs on an AMD GPU instance via vLLM serving Qwen models over ROCm, with a serverless proxy between frontend and instance. Built for the AMD Developer Hackathon: ACT II, submitted under "3DP Agent — Multi-Agent STL Analysis for AMD ROCm."

## Why AMD

The hackathon wasn't why I cared about AMD; it was where I found an excuse to actually use it. The context going in: MI300X the hardware was never in doubt. The open question is the ecosystem — ROCm is AMD's open-source answer to CUDA's moat, but "open" only matters if developers actually build on it, and developers build on what they trust.

The hackathon structure is transparent about what AMD wants: mandatory AMD AI Developer Program signup (a relationship, not a transaction), a GPU pod per team (hands-on time on real hardware), and the Unicorn Track judged on "use of AMD platforms" and "product/market potential" — the judges' instruction is literally *think startup pitch, not benchmark run*. AMD doesn't need more benchmark numbers; they need proof that real products run on AMD, and people who will say so in public.

So three choices turned this from "another hackathon project" into something worth writing about: a real product moved onto AMD (not a demo), open models (Qwen via vLLM, no vendor lock-in at the model layer), and the whole stack left open source.

## Architecture

```
React frontend (HTTPS, Vercel)
    │  POST /api/amd-proxy   (OpenAI-compatible relay)
    ▼
Express / Vercel Serverless proxy
    │  fetch → vLLM endpoint
    ▼
AMD MI300X instance (ROCm + vLLM) → Qwen3-30B-A3B / Qwen3-8B
```

- `amd-cloud` provider in `apiKeys.ts`, same `callAI()` contract as the OpenAI/DeepSeek paths — first-class citizen, not a special case.
- Five sequential agent steps sharing one LLM backend.
- Fireworks AI available as a swappable fallback (shared hackathon GPU availability varied during testing; the track permits any inference provider).

## Timeline: one week, 7 fixes

| Date | Commit | What happened |
|------|--------|---------------|
| Jul 4 | `4fb00f10` | feat: add AMD Cloud support (provider + direct call) |
| Jul 5 | PR #6 merged | MI300X + vLLM + Qwen3-30B-A3B stable inference |
| Jul 6 | `15b4a7cb` | Update instance IP |
| Jul 6 | `0478159d` | Fix provider not recognized |
| Jul 6 | `63fc20e9` | Add proxy route around mixed content |
| Jul 6 | `97130244` | Endpoint reads env var — the real fix for the hardcoded-IP failure |
| Jul 8 | `dadabef9` | Point at hackathon notebook proxy; model name → Qwen3-8B |
| Jul 8 | `7f58578d` | CORS blocked direct call, reverted to proxy path |
| Jul 8 | `d30731df` | Add Vercel Serverless proxy function |
| Jul 10 | `3ac38f5e` | 10s timeout, status code swallowed |

**1. IPs drift.** First cut hardcoded the instance address in `apiKeys.ts`. Next day the instance was rebuilt; the frontend couldn't connect. Fix: `AMD_CLOUD_ENDPOINT` constant, then `AMD_MACHINE_URL` from env. The lesson is still in the source: *"Every time you destroy and recreate your AMD Droplet, you get a new IP."*

**2. Mixed content.** Frontend on Vercel (HTTPS), MI300X exposed plain HTTP. Browsers refuse. Fix: Express relay `/api/amd-proxy`, server makes the request on the browser's behalf.

**3. CORS.** After the instance gained an HTTPS notebook proxy entry, direct client calls were CORS-blocked. Fix: revert to the proxy path. An inference endpoint should never be exposed to a browser frontend — that's an attack-surface decision, not a CORS configuration problem.

**4. Serverless 10s timeout.** Moving the relay to Vercel Serverless broke everything silently — first-token latency plus serial agent calls exceeded the 10s Hobby limit. Fix: `maxDuration: 60`. Serverless defaults are tuned for ordinary APIs; LLM generation needs the limit raised explicitly.

**5. Status codes swallowed.** The relay hardcoded `res.status(200).json(data)`, so upstream 429s/5xx arrived as 200s. Debugging was guesswork. Fix: one line, `res.status(amdRes.status).json(data)`. A relay that eats status codes cuts the troubleshooting path off at the knees.

**6. Provider added, UI didn't recognize it.** `amd-cloud` landed in `apiKeys.ts`, but the key-config UI stayed dark — the active-provider check wasn't updated. Integration is end-to-end: types, key validation, UI state.

**7. Two spellings of the model name.** `Qwen/Qwen3-30B-A3B` (namespaced) vs `Qwen3-8B` (bare) per instance. Model names belong in configuration next to the endpoint.

## What survived

The relay got hardened after the deployment: model allowlist (`AMD_ALLOWED_MODELS`, body validated before any fetch), rate limiting (30 req/min/IP), loopback guard (dev binds `127.0.0.1`; production won't mount GPU routes without a `BRIDGE_TOKEN`), and request-origin chain validation.

## The part worth arguing about

A note for infra engineers: if you were hoping for a CUDA-to-ROCm porting war story, this post will disappoint you. None of the seven issues were ROCm-specific — ephemeral endpoints, mixed content, CORS, serverless timeouts, status-code hygiene. That is the point. When a platform's problems become ordinary infrastructure problems, the platform has arrived. The hardware-specific parts — vLLM serving Qwen on the MI300X, a five-agent pipeline depending on it day after day — worked quietly. Quiet is the compliment.

That's also the honest pitch if you're on the fence about AMD: the hardware is real, ROCm is real, and the failures you'll hit are the normal ones. The project is fully open source, containerized, and documented, so the next person starts a week ahead of where I did.

---

*Submission: [3DP Agent — Multi-Agent STL Analysis for AMD ROCm](https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii/aetherforge/3dp-agent-multi-agent-stl-analysis-for-amd-rocm) · [Repository](https://github.com/BougieZoe/3DP-Agent-) · [Live app](https://3dp-agent.vercel.app/)*
