// @vitest-environment happy-dom
/// <reference types="vitest/globals" />
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLoopPredictions, logLoopPrediction, clearLoopPredictions, pairWithFeedback,
  type LoopPrediction,
} from '../loopCalibration';

function prediction(overrides: Partial<LoopPrediction> = {}): LoopPrediction {
  return {
    fileHash: 'abc123',
    fileName: 'wall_tower.stl',
    timestamp: '2026-09-10T00:00:00.000Z',
    material: 'PLA',
    score: 85,
    band: 'high',
    drivers: ['thin walls 9.5% of samples (−2)'],
    wasteRatio: 0.115,
    thinWallRatio: 0.0952,
    overhangRatio: 0.05,
    supportDifficulty: 'easy',
    ...overrides,
  };
}

describe('loopCalibration', () => {
  beforeEach(() => {
    clearLoopPredictions();
  });

  it('accumulates predictions (no dedupe — trajectories matter)', () => {
    logLoopPrediction(prediction({ score: 80 }));
    logLoopPrediction(prediction({ score: 90 }));
    expect(getLoopPredictions()).toHaveLength(2);
  });

  it('pairs each outcome with the latest prior prediction', () => {
    logLoopPrediction(prediction({ timestamp: '2026-09-10T00:00:00.000Z', score: 80 }));
    logLoopPrediction(prediction({ timestamp: '2026-09-11T00:00:00.000Z', score: 90 }));
    const pairs = pairWithFeedback(getLoopPredictions(), [
      { timestamp: Date.parse('2026-09-12T00:00:00.000Z'), outcome: 'ok' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].prediction.score).toBe(90);
    expect(pairs[0].outcome).toBe('ok');
  });

  it('drops outcomes with no prior prediction', () => {
    logLoopPrediction(prediction({ timestamp: '2026-09-12T00:00:00.000Z' }));
    const pairs = pairWithFeedback(getLoopPredictions(), [
      { timestamp: Date.parse('2026-09-10T00:00:00.000Z'), outcome: 'fail' },
    ]);
    expect(pairs).toHaveLength(0);
  });
});
