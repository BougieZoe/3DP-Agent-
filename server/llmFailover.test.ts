import { describe, expect, it, beforeEach } from 'vitest';
import {
  runFailoverSequence,
  isCircuitOpen,
  recordAttempt,
  resetFailoverState,
  breakerFailures,
  breakerOpenUntil,
  type LlmCandidate,
} from './llmFailover';

describe('llmFailover circuit breaker', () => {
  beforeEach(() => resetFailoverState());

  it('returns ok and resets the breaker on a successful candidate', async () => {
    let calls = 0;
    const candidate: LlmCandidate = {
      id: 'a|m',
      label: 'a/m',
      send: async () => {
        calls += 1;
        return { ok: true };
      },
    };
    const result = await runFailoverSequence([candidate]);
    expect(result).toEqual({ ok: true, provider: 'a/m' });
    expect(calls).toBe(1);
    expect(breakerFailures('a|m')).toBe(0);
  });

  it('opens the circuit after the failure threshold', async () => {
    const fail: LlmCandidate = {
      id: 'a|m',
      label: 'a/m',
      send: async () => ({ ok: false, status: 500 }),
    };
    const now = 1_000_000;
    const opts = { failureThreshold: 2, cooldownMs: 30_000 };
    recordAttempt('a|m', false, opts as never, now);
    expect(isCircuitOpen('a|m', now)).toBe(false);
    recordAttempt('a|m', false, opts as never, now);
    expect(isCircuitOpen('a|m', now)).toBe(true);
    expect(breakerOpenUntil('a|m')).toBe(now + 30_000);
  });

  it('closes (resets) after the cooldown elapsed', async () => {
    const opts = { failureThreshold: 2, cooldownMs: 10_000 };
    recordAttempt('a|m', false, opts as never, 100);
    recordAttempt('a|m', false, opts as never, 100);
    expect(isCircuitOpen('a|m', 100)).toBe(true);
    expect(isCircuitOpen('a|m', 100 + 10_000)).toBe(false);
    // A post-cooldown failure starts a FRESH count (1), so threshold 2 must
    // not re-open the circuit on the first failure after cooldown.
    recordAttempt('a|m', false, opts as never, 100 + 10_000 + 1);
    expect(breakerFailures('a|m')).toBe(1);
    expect(isCircuitOpen('a|m', 100 + 10_000 + 1)).toBe(false);
  });
});

describe('runFailoverSequence', () => {
  beforeEach(() => resetFailoverState());

  it('fails over from a failed primary to a healthy fallback', async () => {
    const calls: string[] = [];
    const primary: LlmCandidate = {
      id: 'p|m',
      label: 'p/m',
      send: async () => {
        calls.push('primary');
        return { ok: false, status: 429, message: 'quota exceeded' };
      },
    };
    const fallback: LlmCandidate = {
      id: 'f|m',
      label: 'f/m',
      send: async () => {
        calls.push('fallback');
        return { ok: true };
      },
    };
    const result = await runFailoverSequence([primary, fallback]);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('f/m');
    expect(calls).toEqual(['primary', 'fallback']);
  });

  it('skips a candidate whose circuit is open', async () => {
    const calls: string[] = [];
    recordAttempt('open|m', false, { failureThreshold: 1, cooldownMs: 60_000 } as never, Date.now());
    const open: LlmCandidate = {
      id: 'open|m',
      label: 'open/m',
      send: async () => {
        calls.push('open');
        return { ok: true };
      },
    };
    const result = await runFailoverSequence([open]);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reports combined error when every candidate fails', async () => {
    const result = await runFailoverSequence([
      { id: 'a|m', label: 'a/m', send: async () => ({ ok: false, status: 429, message: 'rate limited' }) },
      { id: 'b|m', label: 'b/m', send: async () => ({ ok: false, status: 503, message: 'upstream down' }) },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('a/m');
    expect(result.error).toContain('b/m');
  });

  it('surfaces a thrown error from a candidate', async () => {
    const result = await runFailoverSequence([
      { id: 'a|m', label: 'a/m', send: async () => { throw new Error('network reset'); } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network reset');
  });

  it('does not try the fallback once the budget is exhausted', async () => {
    const starts: string[] = [];
    const result = await runFailoverSequence(
      [
        {
          id: 'a|m',
          label: 'a/m',
          send: async () => {
            starts.push('a');
            // burn the whole budget inside the first candidate
            await new Promise((r) => setTimeout(r, 30));
            return { ok: false, status: 500 };
          },
        },
        {
          id: 'b|m',
          label: 'b/m',
          send: async () => {
            starts.push('b');
            return { ok: true };
          },
        },
      ],
      { budgetMs: 10 },
    );
    expect(result.ok).toBe(false);
    expect(starts).toEqual(['a']);
  });
});