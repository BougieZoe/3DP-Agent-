/**
 * Cost ledger
 *
 * Turns analysis numbers into a cost ledger where every line carries its own
 * provenance. The rule this module enforces: **an absent input is not $0**.
 * A line nobody can price stays `unpriced`, is excluded from the subtotal, and
 * drags the total down to an explicit lower bound — so "we don't know" can never
 * masquerade as "it's free".
 *
 * Two placeholders used to break this rule and are deliberately not reproduced:
 *  - post-processing was a hardcoded `0` (free labour, silently),
 *  - failure risk was `warpingRiskScore × materialCost × 0.5` (an invented 0.5
 *    cap that also ignored machine time, i.e. most of the money at risk).
 */

export type CostProvenance = 'measured' | 'estimated' | 'assumed' | 'unpriced';

export type CostLineKey = 'material' | 'machine' | 'support' | 'postProcessing';

/** Where a failure probability came from; `null` when there is none. */
export type FailureProbabilityBasis =
  | 'measured-yield'
  | 'printability-estimate'
  | 'warping-proxy';

export interface CostLine {
  key: CostLineKey;
  label: string;
  /** `null` means unpriced — never 0, never silently dropped. */
  amountUsd: number | null;
  /**
   * Unrounded amount behind `amountUsd`. A $0.002 support line rounds to 0.00,
   * and "0.00" reads as free — consumers use this to render `<$0.01` instead.
   */
  rawAmountUsd: number | null;
  provenance: CostProvenance;
  /** Why the number exists, or why it does not. Always populated. */
  basis: string;
}

export interface CostLedgerInput {
  /** Filament/mass cost from the print-time module. */
  materialCostUsd?: number | null;
  /** Part mass used for that cost; lets support be priced at the same rate. */
  materialWeightGrams?: number | null;
  /** Machine time cost from the print-time module (hours × profile machine rate). */
  machineCostUsd?: number | null;
  supportGrams?: number | null;
  /** Explicit material unit price. When absent it is derived from cost / mass. */
  materialPricePerKgUsd?: number | null;
  postProcessingMinutes?: number | null;
  laborRatePerHourUsd?: number | null;
  /** 0..1 chance a job fails. */
  failureProbability?: number | null;
  failureProbabilityBasis?: FailureProbabilityBasis | null;
}

export interface FailureRiskLine {
  amountUsd: number | null;
  probability: number | null;
  basis: FailureProbabilityBasis | null;
  note: string;
}

export interface CostLedger {
  currency: 'USD';
  lines: CostLine[];
  /** Sum of priced lines only. Unpriced lines contribute nothing. */
  pricedSubtotalUsd: number;
  unpricedKeys: CostLineKey[];
  /** True only when every line could be priced. */
  isComplete: boolean;
  failureRisk: FailureRiskLine;
  /** `null` when failure risk is unpriced — an "expected total" needs both halves. */
  expectedTotalUsd: number | null;
  notes: string[];
}

/** Lines that are physically spent before a failed part would reach post-processing. */
const PRINT_STAGE_KEYS: CostLineKey[] = ['material', 'machine', 'support'];

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function line(
  key: CostLineKey,
  label: string,
  amountUsd: number | null,
  provenance: CostProvenance,
  basis: string,
): CostLine {
  return { key, label, amountUsd: amountUsd === null ? null : round2(amountUsd), rawAmountUsd: amountUsd, provenance, basis };
}

export function buildCostLedger(input: CostLedgerInput): CostLedger {
  const materialCost = num(input.materialCostUsd);
  const materialWeight = num(input.materialWeightGrams);
  const machineCost = num(input.machineCostUsd);
  const supportGrams = num(input.supportGrams);

  // ── material ────────────────────────────────────────────────────────────────
  const materialLine =
    materialCost === null
      ? line('material', 'Material', null, 'unpriced', 'print-time module produced no material cost')
      : line(
          'material',
          'Material',
          materialCost,
          'estimated',
          materialWeight !== null && materialWeight > 0
            ? `${round2(materialWeight)} g at the material table unit price`
            : 'priced by the print-time module, mass breakdown unavailable',
        );

  // ── machine time ────────────────────────────────────────────────────────────
  const machineLine =
    machineCost === null
      ? line('machine', 'Machine time', null, 'unpriced', 'print-time module produced no machine cost')
      : line(
          'machine',
          'Machine time',
          machineCost,
          'estimated',
          'print hours × the printer profile machine rate',
        );

  // ── support ─────────────────────────────────────────────────────────────────
  const declaredPrice = num(input.materialPricePerKgUsd);
  const derivedPrice =
    declaredPrice === null && materialCost !== null && materialWeight !== null && materialWeight > 0
      ? (materialCost / materialWeight) * 1000
      : null;
  const unitPricePerKg = declaredPrice ?? derivedPrice;
  const priceSource = declaredPrice !== null ? 'declared unit price' : 'unit price derived from material cost / mass';

  let supportLine: CostLine;
  if (supportGrams === null) {
    supportLine = line('support', 'Support material', null, 'unpriced', 'support estimation did not run');
  } else if (unitPricePerKg === null) {
    supportLine = line(
      'support',
      'Support material',
      null,
      'unpriced',
      'no material unit price available to price support filament',
    );
  } else {
    supportLine = line(
      'support',
      'Support material',
      (supportGrams / 1000) * unitPricePerKg,
      'estimated',
      `${round2(supportGrams)} g at ${round2(unitPricePerKg)}/kg (${priceSource})`,
    );
  }

  // ── post-processing ─────────────────────────────────────────────────────────
  const postMinutes = num(input.postProcessingMinutes);
  const laborRate = num(input.laborRatePerHourUsd);
  const postLine =
    postMinutes === null || laborRate === null
      ? line(
          'postProcessing',
          'Post-processing',
          null,
          'unpriced',
          'no post-processing labour input configured — not counted as $0',
        )
      : line(
          'postProcessing',
          'Post-processing',
          (postMinutes / 60) * laborRate,
          'estimated',
          `${round2(postMinutes)} min of labour at ${round2(laborRate)}/h`,
        );

  const lines = [materialLine, machineLine, supportLine, postLine];
  const priced = lines.filter((l): l is CostLine & { amountUsd: number } => l.amountUsd !== null);
  const pricedSubtotalUsd = round2(priced.reduce((sum, l) => sum + l.amountUsd, 0));
  const unpricedKeys = lines.filter((l) => l.amountUsd === null).map((l) => l.key);

  // ── failure risk ────────────────────────────────────────────────────────────
  const probability = num(input.failureProbability);
  const probBasis = input.failureProbabilityBasis ?? null;
  let failureRisk: FailureRiskLine;

  if (probability === null || probBasis === null) {
    failureRisk = {
      amountUsd: null,
      probability: null,
      basis: null,
      note: 'no failure probability available — risk cost left unpriced, no invented coefficient applied',
    };
  } else {
    const p = Math.min(1, Math.max(0, probability));
    // Exposure is what a failure would actually burn: print-stage cost only.
    // Post-processing has not happened yet when a print fails, so it is not at risk.
    const exposure = round2(
      priced
        .filter((l) => PRINT_STAGE_KEYS.includes(l.key))
        .reduce((sum, l) => sum + l.amountUsd, 0),
    );
    failureRisk = {
      amountUsd: round2(exposure * p),
      probability: p,
      basis: probBasis,
      note: `${(p * 100).toFixed(1)}% failure probability (${probBasis}) × ${exposure} print-stage exposure`,
    };
  }

  const expectedTotalUsd =
    failureRisk.amountUsd === null ? null : round2(pricedSubtotalUsd + failureRisk.amountUsd);

  const notes: string[] = [];
  if (unpricedKeys.length > 0) {
    notes.push(
      `${unpricedKeys.join(', ')} unpriced — ${pricedSubtotalUsd} is a lower bound, not a complete cost`,
    );
  }
  if (postLine.amountUsd === null) {
    notes.push('post-processing excluded: no labour minutes/rate supplied');
  }
  if (failureRisk.amountUsd === null) {
    notes.push('expected total withheld: failure risk unpriced');
  }
  notes.push(...lines.filter((l) => l.provenance === 'unpriced').map((l) => `${l.key}: ${l.basis}`));

  return {
    currency: 'USD',
    lines,
    pricedSubtotalUsd,
    unpricedKeys,
    isComplete: unpricedKeys.length === 0,
    failureRisk,
    expectedTotalUsd,
    notes,
  };
}

/** Stable accessor so callers do not index `lines` by hand. */
export function getCostLine(ledger: CostLedger, key: CostLineKey): CostLine {
  const found = ledger.lines.find((l) => l.key === key);
  if (!found) throw new Error(`cost ledger has no line for '${key}'`);
  return found;
}

/** Human-readable ledger. Unpriced lines print as `—`, never as `$0.00`. */
export function describeCostLedger(ledger: CostLedger): string {
  const money = (value: number | null): string => (value === null ? '— (unpriced)' : `$${value.toFixed(2)}`);
  const rows = ledger.lines.map((l) => `  ${l.label}: ${money(l.amountUsd)}${l.amountUsd === null ? '' : ` — ${l.basis}`}`);

  const lines = [
    `Cost ledger (${ledger.currency})`,
    ...rows,
    `  Priced subtotal: $${ledger.pricedSubtotalUsd.toFixed(2)}${ledger.isComplete ? '' : ' (lower bound)'}`,
    `  Failure risk: ${money(ledger.failureRisk.amountUsd)} — ${ledger.failureRisk.note}`,
    `  Expected total: ${money(ledger.expectedTotalUsd)}`,
  ];

  return lines.join('\n');
}
