/**
 * Repair tiers — production-safe repair strategy without shipping secrets.
 *
 * Tier 1 (server bridge, pymeshfix): closes holes, best-effort. Only exists
 * where the operator runs the bridge (dev loopback / self-hosted with
 * BRIDGE_TOKEN). Never reachable from static hosting.
 * Tier 2 (browser WASM, manifold offset): thin-wall thickening, no server.
 * Tier 3 (honest stop): open shells with no bridge — say so, keep the —.
 */
import type { GeometrySuggestion } from '@/components/causality/counterfactualEngine';

export type BridgeFailure = 'bridge-absent' | 'repair-failed';

/** Bridge absent = misconfigured/unreachable infra. Everything else = real failure.
 *
 * Proxy-level outages surface as bare HTTP 500/502/504 (no bridge JSON body):
 * a genuine repair crash instead carries the bridge's own error detail
 * (e.g. "mesh process exited …"), which never matches the bare patterns below.
 */
export function classifyBridgeError(err: unknown): BridgeFailure {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /HTTP 404/.test(msg) ||
    /HTTP 503/.test(msg) ||
    /HTTP 500/.test(msg) ||
    /HTTP 502/.test(msg) ||
    /HTTP 504/.test(msg) ||
    /bridge unavailable/i.test(msg) ||
    /Failed to fetch|fetch failed|NetworkError|network error|Load failed/i.test(msg)
  ) {
    return 'bridge-absent';
  }
  return 'repair-failed';
}

/**
 * WASM offset only makes sense for thin walls with affected regions. Among the
 * applicable candidates, prefer the one expected to remove the most risk; ties
 * go to the more confident suggestion. This is the candidate-ranking step of
 * the auto-fix pipeline, not a new prediction.
 */
export function pickWasmSuggestion(
  suggestions: GeometrySuggestion[],
): GeometrySuggestion | null {
  const applicable = suggestions.filter(
    (s) => s.type === 'thicken_wall' && s.affectedPositions.length > 0,
  );
  if (applicable.length === 0) return null;
  return [...applicable].sort(
    (a, b) => b.riskReduction - a.riskReduction || b.confidence - a.confidence,
  )[0];
}
