/**
 * Verdict policy versions — one place, one string.
 *
 * A verdict is only comparable to another verdict taken under the same policy.
 * The version string is therefore identity, not a comment: if the engine writes
 * `wall-2026-11-23a` while a test pins `py-wall-2026-11-23a`, the pin silently
 * matches nothing, the scoreboard comes back empty, and an empty scoreboard
 * reads as "no defects" — the most expensive wrong answer this codebase can
 * give.
 *
 * Rules:
 *  1. No file other than this one writes a policy version literal. Import it.
 *  2. Bumping the policy means bumping `VERDICT_POLICY_VERSION`, recording why
 *     in `docs/plans/shopfloor-model.md`, and leaving historical records on the
 *     version they were judged under — records are never rewritten to match.
 *  3. A version we no longer ship still exists: it marks evidence that must be
 *     excluded from a current rate, not deleted.
 */

/** The policy version the current verdict engine stamps on new verdicts. */
export const VERDICT_POLICY_VERSION = 'wall-2026-11-23a';

/**
 * The version the Python prototype wrote. Historical records only — pin a live
 * scoreboard to this and every current job is filtered out.
 */
export const LEGACY_PYTHON_POLICY_VERSION = 'py-wall-2026-11-20a';

export function isCurrentPolicy(policyVersion: string): boolean {
  return policyVersion === VERDICT_POLICY_VERSION;
}
