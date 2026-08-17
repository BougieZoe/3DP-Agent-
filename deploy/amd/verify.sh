#!/usr/bin/env bash
# Verify a vLLM-on-ROCm instance for the 3DP Agent pipeline.
#
# Run this wherever you can reach the instance:
#   ./verify.sh http://<instance-ip>:8000
# (SSH tunnel: ssh -L 8000:localhost:8000 user@instance && ./verify.sh)
#
# What it checks:
#   1. /v1/models            — what model name to use (kills the model-name quirk)
#   2. prefix cache effect   — same prompt 5x; prefill should drop after the 1st
#   3. end-to-end timing     — a single chat completion with a 3DP prompt
#   4. health                — rocm-smi GPU state, if available on the host

set -euo pipefail

BASE="${1:-http://localhost:8000}"
MODEL=""

echo "== 1. /v1/models =="
curl -sf "${BASE}/v1/models" | python3 -m json.tool || {
  echo "!! /v1/models unreachable at ${BASE}"; exit 1; }
MODEL=$(curl -sf "${BASE}/v1/models" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'])")
echo "-> model id: ${MODEL}"

echo
echo "== 2. Prefix-cache probe (same prompt x5, times in seconds) =="
PAYLOAD=$(mktemp)
cat > "${PAYLOAD}" <<'EOF'
{
  "model": "MODEL_PLACEHOLDER",
  "messages": [
    {"role": "system", "content": "You are the 3DP Geometry Analyst. Report measured geometric facts only, as JSON."},
    {"role": "user", "content": "Wall thickness 0.8mm, overhang 62 degrees on 340 of 1200 faces, mesh watertight: true. Report as JSON."}
  ],
  "max_tokens": 256,
  "temperature": 0
}
EOF
sed -i '' "s/MODEL_PLACEHOLDER/${MODEL}/" "${PAYLOAD}" 2>/dev/null || \
  sed -i "s/MODEL_PLACEHOLDER/${MODEL}/" "${PAYLOAD}"

FIRST=""
for i in 1 2 3 4 5; do
  T=$(curl -sf -o /dev/null -w "%{time_total}" -X POST "${BASE}/v1/chat/completions" \
    -H "Content-Type: application/json" --data-binary @"${PAYLOAD}")
  echo "  call ${i}: ${T}s"
  [ -z "${FIRST}" ] && FIRST="${T}"
done
rm -f "${PAYLOAD}"
echo "-> if calls 2-5 are meaningfully faster than call 1, prefix caching is working."

echo
echo "== 3. End-to-end agent-style call (longer context, 3DP prompt) =="
T=$(curl -sf -o /dev/null -w "%{time_total}" -X POST "${BASE}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"You are the 3DP Optimization Advisor for FDM printing.\"},
      {\"role\": \"user\", \"content\": \"A 120mm bracket with 1.2mm walls, 55-degree overhang, printed in PLA. Give concrete fix advice: layer height, orientation, support density, wall changes. Be specific and brief.\"}
    ],
    \"max_tokens\": 512
  }")
echo "  agent-style call: ${T}s"

echo
echo "== 4. GPU state (only if rocm-smi exists on this host) =="
if command -v rocm-smi >/dev/null 2>&1; then
  rocm-smi --showtemp --showuse --showmeminfo vram 2>/dev/null | head -20 || echo "(rocm-smi present but failed — check ROCm install)"
else
  echo "rocm-smi not found on this host (fine if you run the probe remotely)."
fi

echo
echo "== done. Record the numbers — they become your MI300X benchmark section. =="
