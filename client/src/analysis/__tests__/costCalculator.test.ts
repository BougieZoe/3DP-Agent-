import { describe, it, expect } from 'vitest';
import { calculateCostBreakdown, formatCostBreakdown } from '../costCalculator';
import type { UnifiedAnalysis } from '../types';

interface Stub {
  printTime?: Record<string, unknown> | null;
  support?: Record<string, unknown> | null;
  loopScore?: number;
  warpingRiskScore?: number;
}

function analysis(stub: Stub): UnifiedAnalysis {
  const module = (result: Record<string, unknown> | null | undefined) =>
    result === null || result === undefined
      ? null
      : { moduleName: 'stub', confidence: 1 as const, durationMs: 0, result, explanation: '' };

  return {
    topology: { moduleName: 'topology', confidence: 1, durationMs: 0, result: {}, explanation: '' },
    validation: { moduleName: 'validation', confidence: 1, durationMs: 0, result: {}, explanation: '' },
    metrics: { moduleName: 'metrics', confidence: 1, durationMs: 0, result: {}, explanation: '' },
    bedFit: null,
    support: module(stub.support),
    printTime: module(stub.printTime),
    loop:
      stub.loopScore === undefined
        ? null
        : {
            moduleName: 'loop',
            confidence: 1,
            durationMs: 0,
            result: { firstTime: { score: stub.loopScore, expectedFailureCostUsd: 0, drivers: [] } },
            explanation: '',
          },
    thermal:
      stub.warpingRiskScore === undefined
        ? null
        : {
            moduleName: 'thermal',
            confidence: 1,
            durationMs: 0,
            result: { warpingRiskScore: stub.warpingRiskScore },
            explanation: '',
          },
    timestamp: '2026-11-24T00:00:00.000Z',
    modelFileName: 'part.stl',
    overallConfidence: 1,
  } as unknown as UnifiedAnalysis;
}

describe('calculateCostBreakdown — machine time is not priced twice', () => {
  it('uses the machine cost the print-time module already computed', () => {
    // 10 h at a 6 USD/h profile rate => 60 machine, 2 material, 62 total.
    // The old code would have added another 10 h × 2.0 = 20 on top.
    const cost = calculateCostBreakdown(
      analysis({
        printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100, estimatedPrintTimeHours: 10 },
        loopScore: 90,
      }),
    );

    expect(cost.printTimeCostUsd).toBe(60);
    expect(cost.totalCostUsd).toBe(62); // 2 material + 60 machine (+ support 0 g)
    expect(cost.materialCostUsd + cost.printTimeCostUsd).toBe(cost.totalCostUsd);
  });

  it('never falls back to a flat hourly rate when the profile cost is missing', () => {
    const cost = calculateCostBreakdown(
      analysis({ printTime: { materialCostUsd: 2, materialWeightGrams: 100, estimatedPrintTimeHours: 10 } }),
    );

    expect(cost.printTimeCostUsd).toBe(0);
    expect(cost.unpricedKeys).toContain('machine');
  });
});

describe('calculateCostBreakdown — post-processing is unpriced, never free', () => {
  it('reports no post-processing input as unpriced', () => {
    const cost = calculateCostBreakdown(analysis({ printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 } }));

    expect(cost.postProcessingCostUsd).toBe(0);
    expect(cost.unpricedKeys).toContain('postProcessing');
    expect(cost.isComplete).toBe(false);
    expect(formatCostBreakdown(cost)).toContain('Post-processing: — (unpriced)');
  });

  it('prices post-processing when labour input is supplied', () => {
    const cost = calculateCostBreakdown(
      analysis({
        printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 },
        // A real zero grams of support is a known value, unlike a missing one.
        support: { estimatedSupportGrams: 0 },
      }),
      { postProcessingMinutes: 20, laborRatePerHourUsd: 30 },
    );

    expect(cost.postProcessingCostUsd).toBe(10);
    expect(cost.supportCostUsd).toBe(0);
    expect(cost.unpricedKeys).not.toContain('support');
    expect(cost.isComplete).toBe(true);
    expect(cost.totalCostUsd).toBe(72);
  });

  it('distinguishes a measured zero support mass from a missing one', () => {
    const known = calculateCostBreakdown(
      analysis({
        printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 },
        support: { estimatedSupportGrams: 0 },
      }),
    );
    const unknown = calculateCostBreakdown(
      analysis({ printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 } }),
    );

    expect(known.unpricedKeys).toEqual(['postProcessing']);
    expect(known.ledger?.lines.find((l) => l.key === 'support')?.provenance).toBe('estimated');
    expect(unknown.unpricedKeys).toEqual(['support', 'postProcessing']);
    expect(unknown.ledger?.lines.find((l) => l.key === 'support')?.provenance).toBe('unpriced');
  });
});

describe('calculateCostBreakdown — failure probability stays traceable', () => {
  it('derives probability from the printability score', () => {
    const cost = calculateCostBreakdown(
      analysis({ printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 }, loopScore: 90 }),
    );

    // 10% failure on print-stage exposure 62 => 6.2, no invented 0.5 factor.
    expect(cost.ledger?.failureRisk.probability).toBeCloseTo(0.1, 6);
    expect(cost.ledger?.failureRisk.basis).toBe('printability-estimate');
    expect(cost.failureRiskCostUsd).toBe(6.2);
    expect(cost.expectedTotalCostUsd).toBe(68.2);
  });

  it('falls back to warping risk, labelled as a proxy', () => {
    const cost = calculateCostBreakdown(
      analysis({ printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 }, warpingRiskScore: 0.4 }),
    );

    expect(cost.ledger?.failureRisk.basis).toBe('warping-proxy');
    expect(cost.ledger?.failureRisk.probability).toBeCloseTo(0.4, 6);
  });

  it('withholds the expected total when no probability can be established', () => {
    const cost = calculateCostBreakdown(analysis({ printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 } }));

    expect(cost.failureRiskUnpriced).toBe(true);
    expect(cost.failureRiskCostUsd).toBe(0);
    // Expected total degrades to the priced subtotal rather than inventing risk.
    expect(cost.expectedTotalCostUsd).toBe(cost.totalCostUsd);
  });

  it('prefers an explicit measured yield over inferred risk', () => {
    const cost = calculateCostBreakdown(
      analysis({ printTime: { materialCostUsd: 2, totalCostUsd: 62, materialWeightGrams: 100 }, loopScore: 50 }),
      { failureProbability: 0.05, failureProbabilityBasis: 'measured-yield' },
    );

    expect(cost.ledger?.failureRisk.basis).toBe('measured-yield');
    expect(cost.ledger?.failureRisk.probability).toBeCloseTo(0.05, 6);
  });
});

describe('calculateCostBreakdown — degenerate analysis', () => {
  it('prices nothing and claims nothing when no modules ran', () => {
    const cost = calculateCostBreakdown(analysis({}));

    expect(cost.totalCostUsd).toBe(0);
    expect(cost.unpricedKeys).toEqual(['material', 'machine', 'support', 'postProcessing']);
    expect(cost.isComplete).toBe(false);
    expect(cost.failureRiskUnpriced).toBe(true);
  });
});
