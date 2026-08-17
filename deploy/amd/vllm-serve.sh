#!/usr/bin/env bash
# vLLM serving config for AMD MI300X (ROCm) — 3DP Agent
#
# Run this ON the AMD GPU instance (AMD Developer Cloud), not locally.
# Usage: ./vllm-serve.sh [model]
#
# Key parameters explained:
#   --served-model-name      fixes the "two spellings of the model name" issue —
#                            the client always asks for this exact name, no
#                            matter what HF repo id the checkpoint came from.
#   --enable-prefix-caching  reuse prefill for repeated prefixes (critic
#                            retries, fixed system prompts). Cheap to enable,
#                            real wins on the agent pipeline's retry paths.
#   --gpu-memory-utilization leave headroom for KV cache growth.
#   --max-model-len          5 sequential agent calls carry growing context;
#                            budget generously. 16k fits Qwen3-30B-A3B easily
#                            on MI300X's 192 GB.
#
# ROCm environment:
#   MI300X is gfx942. ROCm 6.x on AMD Developer Cloud images knows it natively,
#   so HSA_OVERRIDE_GFX_VERSION is NOT set by default. Only set it if the
#   runtime complains the device is unsupported (escape hatch for older drivers).

set -euo pipefail

MODEL="${1:-Qwen/Qwen3-30B-A3B}"
SERVED_NAME="${SERVED_NAME:-qwen3-30b-a3b}"
PORT="${PORT:-8000}"
GPU_UTIL="${GPU_UTIL:-0.90}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
DEVICE_IDS="${ROCR_VISIBLE_DEVICES:-0}"

export ROCR_VISIBLE_DEVICES="${DEVICE_IDS}"

# Uncomment only if the runtime fails to detect the GPU:
# export HSA_OVERRIDE_GFX_VERSION=9.4.2   # gfx942 = MI300X

exec vllm serve "${MODEL}" \
  --served-model-name "${SERVED_NAME}" \
  --enable-prefix-caching \
  --gpu-memory-utilization "${GPU_UTIL}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --port "${PORT}" \
  --trust-remote-code
