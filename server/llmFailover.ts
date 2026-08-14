/**
 * llmFailover — circuit breaker + ordered failover for the LLM source
 * authoring step.
 *
 * Problem: CAD generation depends on a single configured LLM provider. A
 * provider-wide 429 (rate limit / quota) or 5xx blip fails the whole
 * generation. Worse, every subsequent click immediately re-hits the same
 * failing provider.
 *
 * Design (pure, unit-testable):
 *   - Per-provider circuit breaker: after N consecutive failures the circuit
 *     OPENS for a cooldown; calls short-circuit instead of burning time on a
 *     provider that just failed. It CLOSES (resets) after a successful call.
 *   - Ordered failover: callers provide [primary, ...fallbacks]; we walk the
 *     list, skipping open circuits, and report a combined error only if all
 *     candidates fail.
 *   - The breaker is deliberately shared across requests (module-level
 *     state) so one burst of 429s doesn't retry every provider on every
 *     click; it lives in this module so tests can reset it.
 */

export interface LlmCandidate {
  /** Stable identity for the breaker (baseUrl + model). */
  id: string;
  /** Human label for logs / errors, e.g. 'deepseek/deepseek-chat'. */
  label: string;
  /**
   * Perform the actual LLM call. On HTTP success return `{ ok: true }`; the
   * content is handed back via a slot so the breaker can stay decoupled from
   * the chat response shape. On failure throw or return `{ ok: false }`.
   */
  send: () => Promise<LlmSendResult>;
}

export type LlmSendResult =
  | { ok: true }
  | { ok: false; status: number; retryAfterSeconds?: number; message?: string };

export interface LlmFailoverOptions {
  /** Consecutive failures before the breaker opens. */
  failureThreshold?: number;
  /** Cooldown (ms) an opened breaker stays open. */
  cooldownMs?: number;
  /** Overall time budget for the whole failover sequence (ms). */
  budgetMs?: number;
  /** Called after a candidate settles, for logging. */
  onLog?: (message: string) => void;
}

interface BreakerState {
  failures: number;
  openUntil: number;
}

const state = new Map<string, BreakerState>();

export function resetFailoverState(): void {
  state.clear();
}

function labelFor(id: string): string {
  return id;
}

/**
 * Whether a provider may be called right now. When the circuit is open we
 * short-circuit so a burst of failures doesn't re-attempt the offender.
 * openUntil === 0 means closed (never failed enough). Pure — no mutation.
 */
export function isCircuitOpen(id: string, now = Date.now()): boolean {
  const s = state.get(id);
  if (!s) return false;
  if (s.openUntil <= 0) return false;
  return now < s.openUntil;
}

/** Record the outcome of a call. Success resets; failure counts toward the threshold. */
export function recordAttempt(
  id: string,
  ok: boolean,
  opts: Required<Pick<LlmFailoverOptions, 'failureThreshold' | 'cooldownMs'>>,
  now = Date.now(),
): void {
  if (ok) {
    state.delete(id);
    return;
  }
  const prev = state.get(id);
  // A failure just after the cooldown elapsed starts a fresh count; a still-
  // open circuit keeps its count (callers short-circuit past open circuits).
  if (prev && prev.openUntil > 0 && now >= prev.openUntil) {
    prev.failures = 0;
    prev.openUntil = 0;
  }
  const s = prev ?? { failures: 0, openUntil: 0 };
  s.failures += 1;
  if (s.failures >= opts.failureThreshold) {
    s.openUntil = now + opts.cooldownMs;
  }
  state.set(id, s);
}

/** @internal for tests — expose how long an opened breaker stays open. */
export function breakerFailures(id: string): number {
  return state.get(id)?.failures ?? 0;
}

export function breakerOpenUntil(id: string): number {
  return state.get(id)?.openUntil ?? 0;
}

export interface FailoverResult {
  ok: boolean;
  /** Which candidate label succeeded, if any. */
  provider?: string;
  /** Combined failure message when all candidates failed. */
  error?: string;
}

/**
 * Try candidates in order, respecting circuits and the overall budget.
 * A candidate that returns 429 with Retry-After is honored within the
 * remaining budget before advancing. The last error carries the most context.
 */
export async function runFailoverSequence(
  candidates: LlmCandidate[],
  opts: LlmFailoverOptions = {},
): Promise<FailoverResult> {
  const failureThreshold = opts.failureThreshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const budgetMs = opts.budgetMs ?? 30_000;
  const onLog = opts.onLog ?? (() => {});
  const deadline = Date.now() + budgetMs;

  const failures: string[] = [];
  let lastError: string | undefined;

  for (const candidate of candidates) {
    if (Date.now() >= deadline) {
      failures.push(`budget exceeded before trying ${candidate.label}`);
      break;
    }
    if (isCircuitOpen(candidate.id)) {
      onLog(`skip ${candidate.label}: circuit open`);
      failures.push(`${candidate.label}: circuit open`);
      continue;
    }

    onLog(`trying ${candidate.label}`);
    let result: LlmSendResult;
    try {
      result = await candidate.send();
    } catch (err) {
      lastError = String(err);
      recordAttempt(candidate.id, false, { failureThreshold, cooldownMs });
      onLog(`${candidate.label} threw: ${lastError}`);
      failures.push(`${candidate.label}: ${lastError}`);
      continue;
    }

    if (result.ok) {
      recordAttempt(candidate.id, true, { failureThreshold, cooldownMs });
      return { ok: true, provider: candidate.label };
    }
    lastError =
      result.message ?? (result.status ? `HTTP ${result.status}` : 'unknown failure');
    if (result.retryAfterSeconds && result.status === 429) {
      const wait = Math.min(result.retryAfterSeconds * 1000, deadline - Date.now());
      if (wait > 0) {
        onLog(`${candidate.label}: 429 retry-after ${result.retryAfterSeconds}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    recordAttempt(candidate.id, false, { failureThreshold, cooldownMs });
    onLog(`${candidate.label} returned: ${lastError}`);
    failures.push(`${candidate.label}: ${lastError}`);
  }

  const message =
    failures.length > 0
      ? failures.join('; ')
      : 'all LLM candidates failed';
  onLog(`failover exhausted: ${message}`);
  return { ok: false, error: lastError ? `${message} (last: ${lastError})` : message };
}

export { labelFor };
