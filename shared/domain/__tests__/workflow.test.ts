import { describe, expect, it } from 'vitest';
import {
  completeStage,
  createPendingStage,
  failStage,
  skipStage,
  startStage,
} from '../workflow';

describe('workflow stage transitions', () => {
  it('uses explicit immutable stage transitions', () => {
    const pending = createPendingStage<{ ok: boolean }>('parse_mesh');
    const running = startStage(pending, '2026-01-01T00:00:00.000Z');
    const completed = completeStage(running, { ok: true }, '2026-01-01T00:00:00.025Z');

    expect(pending.status).toBe('pending');
    expect(running.status).toBe('running');
    expect(completed).toEqual({
      id: 'parse_mesh',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.025Z',
      durationMs: 25,
      output: { ok: true },
    });
  });

  it('represents failed and skipped terminal states', () => {
    const running = startStage(createPendingStage('generate_report'), '2026-01-01T00:00:00.000Z');

    expect(failStage(running, { code: 'x', message: 'failed' }, '2026-01-01T00:00:00.001Z').status).toBe('failed');
    expect(skipStage(running, '2026-01-01T00:00:00.001Z').status).toBe('skipped');
  });
});
