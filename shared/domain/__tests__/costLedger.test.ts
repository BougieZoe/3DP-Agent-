import { describe, it, expect } from 'vitest';
import {
  buildCostLedger,
  describeCostLedger,
  getCostLine,
  type CostLedgerInput,
} from '../costLedger';

/** A fully specified job: every line can be priced. */
function fullInput(overrides: Partial<CostLedgerInput> = {}): CostLedgerInput {
  return {
    materialCostUsd: 2.2,
    materialWeightGrams: 100,
    machineCostUsd: 4,
    supportGrams: 10,
    postProcessingMinutes: 30,
    laborRatePerHourUsd: 20,
    failureProbability: 0.2,
    failureProbabilityBasis: 'printability-estimate',
    ...overrides,
  };
}

describe('costLedger — pricing', () => {
  it('prices every line and reports a complete ledger', () => {
    const ledger = buildCostLedger(fullInput());

    expect(ledger.isComplete).toBe(true);
    expect(ledger.unpricedKeys).toEqual([]);
    expect(getCostLine(ledger, 'material').amountUsd).toBe(2.2);
    expect(getCostLine(ledger, 'machine').amountUsd).toBe(4);
    // Support uses the same unit price as the part: 2.2 / 100 g = 22 / kg.
    expect(getCostLine(ledger, 'support').amountUsd).toBe(0.22);
    // 30 min at 20/h = 10.
    expect(getCostLine(ledger, 'postProcessing').amountUsd).toBe(10);
    expect(ledger.pricedSubtotalUsd).toBe(16.42);
  });

  it('derives the support unit price from material cost and mass', () => {
    const ledger = buildCostLedger(fullInput({ supportGrams: 50 }));
    const support = getCostLine(ledger, 'support');

    expect(support.provenance).toBe('estimated');
    expect(support.basis).toContain('derived from material cost');
    expect(support.amountUsd).toBe(1.1); // 50 g at 22/kg
  });

  it('prefers an explicitly declared unit price over the derived one', () => {
    const ledger = buildCostLedger(fullInput({ materialPricePerKgUsd: 100, supportGrams: 50 }));

    expect(getCostLine(ledger, 'support').amountUsd).toBe(5); // 50 g at 100/kg
    expect(getCostLine(ledger, 'support').basis).toContain('declared unit price');
  });
});

describe('costLedger — an absent input is not $0', () => {
  it('leaves post-processing unpriced instead of free', () => {
    const ledger = buildCostLedger(fullInput({ postProcessingMinutes: null, laborRatePerHourUsd: null }));
    const post = getCostLine(ledger, 'postProcessing');

    expect(post.amountUsd).toBeNull();
    expect(post.provenance).toBe('unpriced');
    expect(ledger.unpricedKeys).toContain('postProcessing');
    expect(ledger.isComplete).toBe(false);
    // The subtotal must not quietly absorb a zero for it.
    expect(ledger.pricedSubtotalUsd).toBe(6.42);
    expect(ledger.notes.some((n) => n.includes('lower bound'))).toBe(true);
  });

  it('leaves post-processing unpriced when only minutes are supplied', () => {
    const ledger = buildCostLedger(fullInput({ laborRatePerHourUsd: null }));

    expect(getCostLine(ledger, 'postProcessing').amountUsd).toBeNull();
    expect(ledger.unpricedKeys).toEqual(['postProcessing']);
  });

  it('leaves material and machine unpriced when the print-time module produced nothing', () => {
    const ledger = buildCostLedger(
      fullInput({ materialCostUsd: null, materialWeightGrams: null, machineCostUsd: null }),
    );

    expect(getCostLine(ledger, 'material').amountUsd).toBeNull();
    expect(getCostLine(ledger, 'machine').amountUsd).toBeNull();
    // Support loses its unit price with them, so it is unpriced too — no guessing.
    expect(ledger.unpricedKeys).toEqual(expect.arrayContaining(['material', 'machine', 'support']));
    expect(ledger.pricedSubtotalUsd).toBe(10); // post-processing only
  });

  it('leaves support unpriced when support estimation did not run', () => {
    const ledger = buildCostLedger(fullInput({ supportGrams: null }));

    expect(getCostLine(ledger, 'support').amountUsd).toBeNull();
    expect(getCostLine(ledger, 'support').basis).toContain('did not run');
  });

  it('refuses to price support when no unit price can be established', () => {
    const ledger = buildCostLedger(
      fullInput({ materialPricePerKgUsd: null, materialCostUsd: null, materialWeightGrams: null }),
    );

    expect(getCostLine(ledger, 'support').amountUsd).toBeNull();
    expect(getCostLine(ledger, 'support').basis).toContain('no material unit price');
  });
});

describe('costLedger — failure risk', () => {
  it('multiplies probability by print-stage exposure only', () => {
    const ledger = buildCostLedger(fullInput());

    // Exposure = material 2.2 + machine 4 + support 0.22 = 6.42 (post-processing
    // has not happened yet when a print fails).
    expect(ledger.failureRisk.amountUsd).toBe(1.28);
    expect(ledger.expectedTotalUsd).toBe(17.7);
    expect(ledger.failureRisk.note).toContain('print-stage exposure');
  });

  it('withholds risk cost and the expected total when no probability exists', () => {
    const ledger = buildCostLedger(fullInput({ failureProbability: null, failureProbabilityBasis: null }));

    expect(ledger.failureRisk.amountUsd).toBeNull();
    expect(ledger.expectedTotalUsd).toBeNull();
    expect(ledger.failureRisk.note).toContain('no invented coefficient');
    expect(ledger.notes.some((n) => n.includes('expected total withheld'))).toBe(true);
  });

  it('requires a basis alongside the probability', () => {
    const ledger = buildCostLedger(fullInput({ failureProbabilityBasis: null }));

    expect(ledger.failureRisk.amountUsd).toBeNull();
  });

  it('clamps out-of-range probabilities', () => {
    const high = buildCostLedger(fullInput({ failureProbability: 4 }));
    const low = buildCostLedger(fullInput({ failureProbability: -1 }));

    expect(high.failureRisk.probability).toBe(1);
    expect(high.failureRisk.amountUsd).toBe(6.42); // never more than full exposure
    expect(low.failureRisk.amountUsd).toBe(0);
  });

  it('carries the probability basis through unchanged', () => {
    const ledger = buildCostLedger(fullInput({ failureProbabilityBasis: 'warping-proxy' }));

    expect(ledger.failureRisk.basis).toBe('warping-proxy');
  });
});

describe('costLedger — description', () => {
  it('renders unpriced lines as a dash rather than $0.00', () => {
    const text = describeCostLedger(
      buildCostLedger(fullInput({ postProcessingMinutes: null, laborRatePerHourUsd: null })),
    );

    expect(text).toContain('Post-processing: — (unpriced)');
    expect(text).not.toContain('Post-processing: $0.00');
    expect(text).toContain('Priced subtotal: $6.42 (lower bound)');
  });

  it('marks a complete ledger without the lower-bound caveat', () => {
    const text = describeCostLedger(buildCostLedger(fullInput()));

    expect(text).not.toContain('lower bound');
    expect(text).toContain('Expected total: $17.70');
  });

  it('renders a withheld expected total as unpriced', () => {
    const text = describeCostLedger(
      buildCostLedger(fullInput({ failureProbability: null, failureProbabilityBasis: null })),
    );

    expect(text).toContain('Expected total: — (unpriced)');
  });
});

describe('costLedger — accessor contract', () => {
  it('throws on an unknown line instead of returning a fake zero', () => {
    const ledger = buildCostLedger(fullInput());
    // @ts-expect-error — guarding the runtime path for untyped callers.
    expect(() => getCostLine(ledger, 'labour')).toThrow(/no line for 'labour'/);
  });

  it('rounds money to cents so totals are not float noise', () => {
    const ledger = buildCostLedger(
      fullInput({ materialCostUsd: 1.005, materialWeightGrams: 3, machineCostUsd: 0 }),
    );

    for (const line of ledger.lines) {
      if (line.amountUsd !== null) {
        expect(line.amountUsd).toBe(Math.round(line.amountUsd * 100) / 100);
      }
    }
    expect(ledger.pricedSubtotalUsd).toBe(Math.round(ledger.pricedSubtotalUsd * 100) / 100);
  });
});
