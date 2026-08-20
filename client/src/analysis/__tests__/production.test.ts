import { describe, expect, it } from 'vitest';
import { productionFromUnified } from '../production';
import type { UnifiedAnalysis } from '../types';
import type { Material } from '@shared/domain/material';

const SLS: Material = {
  name: 'PA12 (Nylon 12)', technology: 'sls', category: 'x', description: 'x', useCase: 'x',
  overhangThreshold: 65, densityGPerCm3: 1.01, pricePerKgUsd: 45,
};
const FDM: Material = {
  name: 'PLA', technology: 'fdm', category: 'x', description: 'x', useCase: 'x',
  overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 22,
};
const CONCRETE: Material = {
  name: 'Standard Concrete Mix', technology: 'concrete', category: 'x', description: 'x', useCase: 'x',
  overhangThreshold: 35, densityGPerCm3: 2.40, pricePerKgUsd: 0.15,
};

function fakeUnified(dims: { x: number; y: number; z: number }, totalCostUsd: number, materialCostUsd: number): UnifiedAnalysis {
  return {
    topology: { moduleName: 'topology', confidence: 1.0 as const, durationMs: 0, result: {} as never, explanation: '' },
    validation: { moduleName: 'validation', confidence: 1.0 as const, durationMs: 0, result: {} as never, explanation: '' },
    metrics: { moduleName: 'metrics', confidence: 1.0 as const, durationMs: 0, result: { meshVolumeMm3: 1000, boundingBoxDimensionsMm: dims } as never, explanation: '' },
    printTime: { moduleName: 'printTime', confidence: 1.0 as const, durationMs: 0, result: { totalCostUsd, materialCostUsd } as never, explanation: '' },
    bedFit: null, support: null, timestamp: '', modelFileName: 'x.stl', overallConfidence: 1.0 as const,
  } as UnifiedAnalysis;
}

describe('productionFromUnified', () => {
  it('a small SLS part nests many per build and amortizes machine cost', () => {
    const p = productionFromUnified(fakeUnified({ x: 30, y: 30, z: 30 }, 60, 3), SLS)!;
    expect(p.partsPerBatch).toBeGreaterThan(10); // 300×300×300 / 30³ ≈ 1000 × 0.6
    expect(p.perPartCostUsd).toBeLessThan(60);   // machine cost divided across the batch
    expect(p.score).toBeGreaterThanOrEqual(70);  // SLS is production-friendly
    expect(p.verdict).toBe('production');
  });

  it('FDM stays per-part cost and leans prototype', () => {
    const p = productionFromUnified(fakeUnified({ x: 80, y: 80, z: 80 }, 25, 2), FDM)!;
    expect(p.perPartCostUsd).toBe(25);           // serial — no amortization
    expect(p.score).toBeLessThan(70);
  });

  it('concrete reports single-piece construction (batch not applicable)', () => {
    const p = productionFromUnified(fakeUnified({ x: 300, y: 300, z: 300 }, 200, 10), CONCRETE)!;
    expect(p.partsPerBatch).toBe(1);
    expect(p.note).toContain('does not apply');
  });

  it('a part larger than the build volume cannot nest (partsPerBatch 1)', () => {
    const p = productionFromUnified(fakeUnified({ x: 1000, y: 1000, z: 1000 }, 90, 5), SLS)!;
    expect(p.partsPerBatch).toBe(1);
    expect(p.score).toBeLessThan(70);
  });
});
