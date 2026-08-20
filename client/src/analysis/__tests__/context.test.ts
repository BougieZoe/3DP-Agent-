import { describe, expect, it } from 'vitest';
import { assessContext } from '../context';
import type { UnifiedAnalysis } from '../types';

function fakeUnified(overrides: Partial<UnifiedAnalysis> = {}): UnifiedAnalysis {
  const base = {
    topology: { moduleName: 'topology', confidence: 1.0 as const, durationMs: 0, result: {} as never, explanation: '' },
    validation: { moduleName: 'validation', confidence: 1.0 as const, durationMs: 0, result: {} as never, explanation: '' },
    metrics: { moduleName: 'metrics', confidence: 1.0 as const, durationMs: 0, result: { minWallThicknessMm: 3, overhang: { ratio: 0.1 } } as never, explanation: '' },
    bedFit: null, support: null, printTime: null,
    timestamp: '', modelFileName: 'x.stl', overallConfidence: 1.0 as const,
  } as UnifiedAnalysis;
  return { ...base, ...overrides };
}

describe('object-context assessment', () => {
  it('general context on a healthy part reports no major concerns and low risk', () => {
    const ctx = assessContext(fakeUnified(), 'general');
    expect(ctx.overallRisk).toBeLessThan(0.5);
    expect(ctx.topConcerns.join(' ')).toContain('No major concerns');
  });

  it('structural context flags thin walls as a strength risk', () => {
    const ctx = assessContext(
      fakeUnified({ metrics: { moduleName: 'metrics', confidence: 1.0 as const, durationMs: 0, result: { minWallThicknessMm: 0.4, overhang: { ratio: 0.6 } } as never, explanation: '' } }),
      'structural',
    );
    expect(ctx.topConcerns.some(c => c.includes('thin walls'))).toBe(true);
  });

  it('detailed context surfaces resin suction risk when present', () => {
    const ctx = assessContext(
      fakeUnified({
        metrics: { moduleName: 'metrics', confidence: 1.0 as const, durationMs: 0, result: { minWallThicknessMm: 2, overhang: { ratio: 0.2 } } as never, explanation: '' },
        resin: { moduleName: 'resin', confidence: 1.0 as const, durationMs: 0, result: { shellCount: 1, enclosedCavity: false, islandCount: 0, suctionRisk: 0.8, cureRisk: 0.2, orientation: 'default', footprintAreaMm2: 100 } as never, explanation: '' },
      }),
      'detailed',
    );
    expect(ctx.topConcerns.some(c => c.toLowerCase().includes('suction'))).toBe(true);
  });

  it('liquid-cooling context flags thin pressure walls and dead-end channels', () => {
    const ctx = assessContext(
      fakeUnified({
        metrics: { moduleName: 'metrics', confidence: 1.0 as const, durationMs: 0, result: { minWallThicknessMm: 0.3, p5WallThicknessMm: 0.2, thinWallRatio: 0.15, surfaceAreaMm2: 1000, meshVolumeMm3: 2000 } as never, explanation: '' },
        topology: { moduleName: 'topology', confidence: 1.0 as const, durationMs: 0, result: { shellCount: 2 } as never, explanation: '' },
      }),
      'liquid-cooling',
    );
    expect(ctx.overallRisk).toBeGreaterThan(0.5);
    expect(ctx.topConcerns.some(c => c.toLowerCase().includes('leak'))).toBe(true);
    expect(ctx.topConcerns.some(c => c.toLowerCase().includes('coolant'))).toBe(true);
  });
});
