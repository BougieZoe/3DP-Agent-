#!/usr/bin/env python3
"""
Build a fine-tuning dataset for 3DP Agent's domain LoRA (Qwen3-8B, ROCm).

Two inputs, both optional:
  1. .cad-bridge/metrics.jsonl        -> prompt pool (CAD generation history)
  2. deploy/amd/agent-traces.jsonl    -> real agent I/O pairs (AgentTrace shape,
                                        see client/src/lib/agentPipeline.ts)

Output (alpaca-style, LLaMA-Factory compatible):
  deploy/amd/train.jsonl
  {"instruction": ..., "input": ..., "output": ...}

Agent traces are captured automatically: every deep analysis POSTs each
pipeline step to the local server's /api/agent-trace endpoint (mounted with
the dev bridges), which appends to deploy/amd/agent-traces.jsonl. No manual
capture needed — just run a few real analyses with the dev server up.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
METRICS = ROOT / ".cad-bridge" / "metrics.jsonl"
TRACES = Path(__file__).resolve().parent / "agent-traces.jsonl"
OUT = Path(__file__).resolve().parent / "train.jsonl"
PROMPTS = Path(__file__).resolve().parent / "prompts.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def build_prompt_pool() -> int:
    """metrics.jsonl holds CAD prompts (diversity source for instruction data)."""
    rows = load_jsonl(METRICS)
    seen = set()
    with PROMPTS.open("w") as fh:
        for r in rows:
            prompt = (r.get("prompt") or "").strip()
            if not prompt or prompt in seen:
                continue
            seen.add(prompt)
            fh.write(json.dumps({"prompt": prompt, "success": r.get("success"),
                                 "provider": r.get("provider")}) + "\n")
    return len(seen)


def build_train_set() -> tuple[int, int]:
    """agent-traces.jsonl (AgentTrace shape) -> (instruction, input, output)."""
    traces = load_jsonl(TRACES)
    if not traces:
        return 0, 0

    agent_labels = {
        "geometry": "Act as the 3DP Geometry Analyst. Measure wall thickness, "
                    "overhang, watertightness from the model data.",
        "failure": "Act as the 3DP Failure Predictor. Predict likely print "
                   "failures from the geometry analysis.",
        "optimization": "Act as the 3DP Optimization Advisor. Give concrete "
                        "fixes for the analyzed part.",
        "score": "Act as the 3DP Printability Scorer. Produce a 0-100 score "
                 "consistent with upstream findings.",
        "orchestrator": "Act as the 3DP Orchestrator. Summarize all agent "
                        "findings for a 3D printing engineer.",
    }

    n = 0
    with OUT.open("w") as fh:
        for t in traces:
            agent = (t.get("agent") or t.get("agentName") or "").lower()
            # Prefer the real system prompt when traces carry it (AgentTrace);
            # fall back to the role label otherwise.
            instruction = (t.get("systemPrompt") or "").strip() or agent_labels.get(
                agent.split()[0] if agent else "", "Analyze this 3D print model data.")
            context = (t.get("userContext") or t.get("user_context")
                       or t.get("context") or t.get("input") or "")
            raw = t.get("raw") or t.get("output") or ""
            if not raw:
                continue
            fh.write(json.dumps({
                "instruction": instruction,
                "input": context,
                "output": raw,
            }, ensure_ascii=False) + "\n")
            n += 1
    return n, len(traces)


def main() -> None:
    prompts = build_prompt_pool()
    print(f"[1/2] prompt pool: {prompts} unique prompts from metrics.jsonl -> {PROMPTS.name}")

    train, traces = build_train_set()
    if train == 0:
        print(f"[2/2] no agent traces yet ({TRACES.name} missing or empty).")
        print("      -> run a few real analyses with the dev server up; each")
        print("         deep-analysis step is POSTed to /api/agent-trace and")
        print("         appended here automatically.")
        sys.exit(1)

    print(f"[2/2] train set: {train} pairs from {traces} traces -> {OUT.name}")
    print("      next step: LLaMA-Factory LoRA on Qwen3-8B (ROCm)")


if __name__ == "__main__":
    main()
