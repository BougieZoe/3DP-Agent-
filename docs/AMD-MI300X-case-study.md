# Building on AMD ROCm — and Why I Want More People To

**A one-week deployment retrospective — seven fixes — on running a real product's LLM inference on AMD Instinct MI300X, from the AMD Developer Hackathon: ACT II**

> This is the story of wiring 3DP Agent's multi-agent LLM pipeline onto AMD Instinct MI300X (ROCm + vLLM) — the architecture, the failures, and why I came out of it believing AMD's open-ecosystem bet is one worth pushing forward.
> Every fact is traceable: git commits, PR records, code comments, and the project submission for the hackathon. No invented benchmarks.

---

## 1. The submission

3DP Agent is a browser-based tool that analyzes 3D print files before they ever reach a printer. Designers ship geometry that renders beautifully but fails physically — walls too thin to survive FDM printing, overhangs so severe that supports become mandatory. Those defects are invisible on screen; they cost hours of print time and filament to discover.

The core is a five-agent pipeline: a Geometry Analyst measures wall thickness and overhang distribution, a Printability Scorer weighs the metrics into a single score, a Failure Predictor flags specific failure modes, an Optimization Advisor suggests fixes, and an orchestrator combines all four into a weighted consensus verdict with a full voting record. In practice the pipeline is one function calling the LLM five times in sequence, swapping the system prompt and feeding each step's JSON output into the next.

Inference runs on an AMD GPU instance via vLLM serving Qwen models over ROCm, with a serverless proxy between the frontend and the instance. It was built for, and submitted to, the **AMD Developer Hackathon: ACT II** — under the project title **"3DP Agent — Multi-Agent STL Analysis for AMD ROCm."**

## 2. Why AMD — the bet behind the build

The hackathon wasn't why I cared about AMD. It was where I found an excuse to actually use it.

Here's the context I had going in: AMD's hardware story is already strong — MI300X is a real contender. The open question was never silicon. It's the ecosystem. ROCm is AMD's open-source answer to CUDA's moat: open-source GPU computing, PyTorch and TensorFlow on AMD hardware, CUDA porting paths. But "open" only matters if developers actually build on it, and developers only build on what they trust. The trust gap is the moat.

Watch how the hackathon was structured, and you see exactly what AMD is trying to do:

- Every participant must sign up for the **AMD AI Developer Program** — an intentional relationship, not a transaction.
- Each team gets a **GPU pod** — hands-on time on real AMD hardware, with training materials and expert office hours attached.
- The **Unicorn Track** (where I competed) is judged on creativity, completeness, **use of AMD platforms**, and **product/market potential**. The judges' instruction is explicit: *think startup pitch, not benchmark run.*

That last line is the tell. AMD doesn't need more benchmark numbers — they have those. They need **proof that real products run on AMD**, and they need **people who will say so in public**. A hackathon is the cheapest way to buy both: thousands of builders, each with a GPU pod, each producing a demo, a story, and maybe a startup.

So the hackathon gave me the framing, but the commitment had to be real or it wouldn't be worth writing about. I made three choices that turned this from "another hackathon project" into a genuine bet on the AMD ecosystem:

1. **A real product, not a demo.** 3DP Agent existed before the hackathon, with real users' BYOK flows. I didn't build a toy for the track — I moved production inference onto AMD hardware.
2. **Open models, not proprietary APIs.** The pipeline runs Qwen models through vLLM. No vendor lock-in at the model layer — the same architecture swaps in any open-weight model.
3. **The whole stack stays open.** The project is fully open source, containerized, documented — so the next AMD developer doesn't have to start from zero.

## 3. Target architecture

```
React frontend (HTTPS, Vercel)
    │  POST /api/amd-proxy   (OpenAI-compatible chat/completions relay)
    ▼
Express / Vercel Serverless proxy
    │  fetch → vLLM OpenAI-compatible endpoint
    ▼
AMD Instinct MI300X instance (ROCm + vLLM)
    └── Qwen3-30B-A3B / Qwen3-8B
```

- **Inference**: vLLM on an MI300X instance, exposing OpenAI-compatible `/v1/chat/completions` — reachable through the hackathon's Radeon cloud instance proxy (HuggingFace-style, port 8000).
- **Client integration**: an `amd-cloud` provider in `apiKeys.ts`, speaking the same `callAI()` contract as the OpenAI/DeepSeek paths — the AMD route slots in as a first-class citizen, not a special case.
- **Agent pipeline**: five sequential agent steps sharing one LLM backend; the AMD instance is their inference substrate.
- **Proxy layer**: the browser never talks to the GPU box directly — a lesson I paid for in week one.
- **Provider fallback**: a second provider (Fireworks AI) is available as a swappable fallback — the track permits any inference provider, and shared hackathon GPU availability varied during testing. The AMD route is primary; the architecture treats inference providers as interchangeable. That's what an open ecosystem should feel like from the developer side.

## 4. Timeline: one week, 7 fixes

The commit history preserved the whole arc:

| Date | Commit | What happened |
|------|--------|---------------|
| Jul 4 | `4fb00f10` | feat: add AMD Cloud support (provider + direct call) |
| Jul 5 | PR #6 merged | MI300X + vLLM + Qwen3-30B-A3B stable inference |
| Jul 6 | `15b4a7cb` | Update instance IP |
| Jul 6 | `0478159d` | Fix provider not recognized |
| Jul 6 | `63fc20e9` | Add proxy route around mixed content |
| Jul 6 | `97130244` | Endpoint reads env var — the real fix for the hardcoded-IP failure |
| Jul 8 | `dadabef9` | Point at hackathon notebook proxy; model name → Qwen3-8B |
| Jul 8 | `7f58578d` | **CORS blocked direct call**, reverted to proxy path |
| Jul 8 | `d30731df` | Add Vercel Serverless proxy function |
| Jul 10 | `3ac38f5e` | **10s timeout**, **status code swallowed** |

### Failure 1: IPs drift; hardcoded endpoints die

The first cut hardcoded the instance address in `apiKeys.ts` (a bare `http://129.212.x.x:8000`). Next day the instance was rebuilt, the IP changed, the frontend couldn't connect.

**Fix**: extract `AMD_CLOUD_ENDPOINT` as a constant, then read `AMD_MACHINE_URL` from the environment. The lesson got nailed into the source as a comment:

> "Every time you destroy and recreate your AMD Droplet, you get a new IP."

GPU instances are consumables. Endpoints must be configurable.

### Failure 2: HTTPS page × HTTP backend = mixed content block

The frontend ships on Vercel (HTTPS); the MI300X instance exposed plain HTTP. Browser security policy refuses: an HTTPS page may not request an HTTP origin.

**Fix**: an Express relay route `/api/amd-proxy` — the server makes the request on the browser's behalf. The comment at the time was blunt:

> "AMD Cloud proxy: the browser is HTTPS, the AMD machine is HTTP, browser rules won't allow direct connection. The server makes the request instead."

### Failure 3: HTTPS direct calls, then CORS blocked them

The instance later gained an HTTPS notebook proxy entry, and we tried direct client calls — CORS rejected them.

**Fix**: `Revert AMD_CLOUD_ENDPOINT to proxy path`. The conclusion crystallized: **an inference endpoint should never be exposed to a browser frontend at all** — not a CORS configuration problem, an attack-surface problem. Keep the relay; the CORS problem disappears structurally.

### Failure 4: Vercel Serverless default 10s timeout

After moving the relay to a Vercel Serverless function (`api/amd-proxy.ts`), generation started timing out — first-token latency plus serial multi-agent calls routinely exceeded the Hobby plan's 10s function limit.

**Fix**: declare `maxDuration: 60` explicitly. From the code comment:

> "Default Vercel function timeout is 10s — LLM generation routinely takes longer than that, especially through a multi-agent pipeline."

Serverless defaults are tuned for ordinary APIs. Wiring an LLM behind them without raising the timeout means everything works except the actual requests.

### Failure 5: The proxy swallowed upstream status codes

Subtler: the relay hardcoded `res.status(200).json(data)`, so upstream 429s and 5xx arrived as 200s. The client parsed a body with no `choices`, produced a meaningless error, and debugging became guesswork.

**Fix**: one line — `res.status(amdRes.status).json(data)`. Status codes are the first diagnostic signal of any API; a relay that eats them cuts the troubleshooting path off at the knees.

### Failure 6: Provider added, UI didn't recognize it

After `amd-cloud` landed in `apiKeys.ts`, the "configure API key" entry in the UI stayed dark — `APIKeyModal`'s active-provider check didn't count the new provider. Feature-level integration ≠ UI-level integration. Registration must be end-to-end: types, key validation, UI state.

### Failure 7: Two spellings of the model name

`Qwen/Qwen3-30B-A3B` (namespaced) and `Qwen3-8B` (bare) had to be passed differently per instance. Trivial on paper, real friction when switching instances — model names belong in configuration next to the endpoint, not scattered through call sites.

## 5. What survived: the final shape is more than "it works"

After the deployment wrapped, the relay got hardened repeatedly in later architecture passes:

- **Model allowlist**: `AMD_ALLOWED_MODELS` admits only `Qwen3-8B` / `Qwen3-30B-A3B`. The proxy is not a general-purpose HTTP forwarder — the body is validated (model, non-empty `messages`, `max_tokens ≤ 4096`) before any fetch.
- **Rate limiting**: in-memory limiter, 30 req/min per IP.
- **Loopback guard**: dev binds `127.0.0.1` only; production refuses to mount GPU-related routes without a `BRIDGE_TOKEN`.
- **Request-origin chain validation**: `loopbackGuard` decides from the request-source chain, never from the bind host — a dev server accidentally published on `0.0.0.0` doesn't silently leak the bridges.

## 6. Why I want to push AMD and ROCm forward

Here's the part I want to be explicit about, because it's the reason this essay exists.

For a long time, if you wanted to run open models in production, your real options funneled through one vendor's software stack. ROCm is the credible alternative: open-source, runs the same frameworks, and — as of 2026 — runs real inference workloads well enough that a five-agent pipeline can depend on it. That matters beyond AMD's market share. An open GPU compute ecosystem is what keeps AI infrastructure from becoming a single point of control. AMD's hackathon model — GPU pods in developers' hands, credits, a developer program, a track that literally asks for *startups* — is the most direct way they're trying to grow that ecosystem, and it worked on me.

I walked in curious and came out convinced, but not because of marketing. Because of week one. I made seven fixes in a week, none of them "ROCm can't do this" — all of them standard distributed-systems issues (ephemeral endpoints, mixed content, CORS, serverless timeouts, status-code hygiene). That's the difference between an ecosystem that's talked about and one that's real: the failures are ordinary.

A note for infra engineers reading this: if you were hoping for a CUDA-to-ROCm porting war story, this post will disappoint you. None of the seven issues were ROCm-specific — they were ephemeral endpoints, mixed content, CORS, serverless timeouts, status-code hygiene. That is the point. When a platform's problems become ordinary infrastructure problems, the platform has arrived. The hardware-specific parts — vLLM serving Qwen on the MI300X, a five-agent pipeline depending on it day after day — worked, and worked quietly. Quiet is the compliment.

So the mission part is simple: **the more real products ship on ROCm, the more the open path survives.** That's why this project is fully open source, containerized, and documented — so the next person who wants to run open models on AMD hardware starts a week ahead of where I did. If you're a developer on the fence about AMD, here's the honest pitch from someone who shipped: the hardware is real, ROCm is real, and the failures you'll hit are the normal ones. The ecosystem needs your build more than it needs your praise.

## 7. Takeaways worth reusing

1. **GPU instances are consumables; endpoints must be config.** IPs move, instances get destroyed and rebuilt. Hardcoding is planting a time bomb.
2. **A browser should never call an inference endpoint directly.** Mixed content and CORS are the browser making security decisions for you — work with them by thickening the proxy layer, not around them.
3. **With serverless + LLM, timeout and status codes are the first things to verify.** Defaults are tuned for ordinary APIs.
4. **"Integration" is end-to-end.** Provider registration, UI recognition, error passthrough, configuration management — miss any link in the chain and the feature effectively doesn't exist.
5. **An ecosystem matures when the failures become ordinary.** The day your AMD deployment's problems are boring infrastructure problems — not platform problems — is the day the open path is real.

---

*Submission: [3DP Agent — Multi-Agent STL Analysis for AMD ROCm](https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii/aetherforge/3dp-agent-multi-agent-stl-analysis-for-amd-rocm) · [Repository](https://github.com/BougieZoe/3DP-Agent-) · [Live app](https://3dp-agent.vercel.app/)*
