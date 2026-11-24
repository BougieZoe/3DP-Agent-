/**
 * Cost Calculator
 *
 * Adapter between the analysis pipeline and the cost ledger.
 *
 * Two things this module deliberately no longer does:
 *  1. It does not add a hardcoded `2.0 USD/h` on top of print time. The
 *     print-time module already prices machine time from the printer profile
 *     (`hours × machineRatePerHourUsd`), so charging a second flat rate here
 *     double-counted the machine.
 *  2. It does not report post-processing as `$0`. No labour input is configured
 *     anywhere in the pipeline, so the line is *unpriced* — see `costLedger`.
 *
 * Failure risk is now `probability × print-stage cost` with the probability
 * traceable to a named basis, instead of `warpingRiskScore × material × 0.5`.
 */

import type { UnifiedAnalysis, CostBreakdown } from './types';
import {
  buildCostLedger,
  describeCostLedger,
  getCostLine,
  type CostLedger,
  type CostProvenance,
  type FailureProbabilityBasis,
} from '@shared/domain/costLedger';

export interface CostCalculationOptions {
  /** Post-processing labour. Absent => the line stays unpriced. */
  postProcessingMinutes?: number | null;
  laborRatePerHourUsd?: number | null;
  /** Material unit price; when absent it is derived from material cost / mass. */
  materialPricePerKgUsd?: number | null;
  /** Override the inferred failure probability (0..1). */
  failureProbability?: number | null;
  failureProbabilityBasis?: FailureProbabilityBasis | null;
}

/**
 * Infer failure probability from analysis output, keeping its basis explicit.
 * Printability score is preferred: it is rule-based and covers support, overhang
 * and thin walls. Warping risk is a geometry proxy, used only when the score is
 * unavailable, and it is labelled as such.
 */
function inferFailureProbability(analysis: UnifiedAnalysis): {
  probability: number | null;
  basis: FailureProbabilityBasis | null;
} {
  const score = analysis.loop?.result?.firstTime?.score;
  if (typeof score === 'number' && Number.isFinite(score)) {
    return { probability: Math.min(1, Math.max(0, 1 - score / 100)), basis: 'printability-estimate' };
  }

  const warping = analysis.thermal?.result?.warpingRiskScore;
  if (typeof warping === 'number' && Number.isFinite(warping)) {
    return { probability: Math.min(1, Math.max(0, warping)), basis: 'warping-proxy' };
  }

  return { probability: null, basis: null };
}

export function calculateCostBreakdown(
  analysis: UnifiedAnalysis,
  options: CostCalculationOptions = {},
): CostBreakdown {
  const printTime = analysis.printTime?.result ?? null;
  const support = analysis.support?.result ?? null;

  const materialCostUsd = printTime ? printTime.materialCostUsd ?? null : null;
  const materialWeightGrams = printTime ? printTime.materialWeightGrams ?? null : null;

  // Machine time, already priced by the print-time module — do not re-price it.
  const machineCostUsd =
    printTime && typeof printTime.totalCostUsd === 'number' && typeof printTime.materialCostUsd === 'number'
      ? Math.max(0, printTime.totalCostUsd - printTime.materialCostUsd)
      : null;

  const inferred =
    options.failureProbabilityBasis !== undefined && options.failureProbabilityBasis !== null
      ? { probability: options.failureProbability ?? null, basis: options.failureProbabilityBasis }
      : options.failureProbability !== undefined && options.failureProbability !== null
        ? { probability: options.failureProbability, basis: 'measured-yield' as FailureProbabilityBasis }
        : inferFailureProbability(analysis);

  const ledger: CostLedger = buildCostLedger({
    materialCostUsd,
    materialWeightGrams,
    machineCostUsd,
    supportGrams: support ? support.estimatedSupportGrams ?? null : null,
    materialPricePerKgUsd: options.materialPricePerKgUsd ?? null,
    postProcessingMinutes: options.postProcessingMinutes ?? null,
    laborRatePerHourUsd: options.laborRatePerHourUsd ?? null,
    failureProbability: inferred.probability,
    failureProbabilityBasis: inferred.basis,
  });

  const materialLine = getCostLine(ledger, 'material');
  const machineLine = getCostLine(ledger, 'machine');
  const supportLine = getCostLine(ledger, 'support');
  const postLine = getCostLine(ledger, 'postProcessing');

  const provenance: Record<string, CostProvenance> = {
    material: materialLine.provenance,
    machine: machineLine.provenance,
    support: supportLine.provenance,
    postProcessing: postLine.provenance,
  };

  return {
    // Numeric mirrors kept for existing consumers; `unpricedKeys` says which of
    // these must not be read as a real zero.
    materialCostUsd: materialLine.amountUsd ?? 0,
    printTimeCostUsd: machineLine.amountUsd ?? 0,
    supportCostUsd: supportLine.amountUsd ?? 0,
    postProcessingCostUsd: postLine.amountUsd ?? 0,
    totalCostUsd: ledger.pricedSubtotalUsd,
    failureRiskCostUsd: ledger.failureRisk.amountUsd ?? 0,
    expectedTotalCostUsd: ledger.expectedTotalUsd ?? ledger.pricedSubtotalUsd,
    ledger,
    unpricedKeys: ledger.unpricedKeys,
    failureRiskUnpriced: ledger.failureRisk.amountUsd === null,
    isComplete: ledger.isComplete,
    provenance,
  };
}

export function formatCostBreakdown(cost: CostBreakdown): string {
  if (cost.ledger) return describeCostLedger(cost.ledger);

  // Fallback for callers holding a hand-built breakdown without a ledger.
  return [
    `材料成本: $${cost.materialCostUsd.toFixed(2)}`,
    `打印时间成本: $${cost.printTimeCostUsd.toFixed(2)}`,
    `支撑材料成本: $${cost.supportCostUsd.toFixed(2)}`,
    `后处理成本: $${cost.postProcessingCostUsd.toFixed(2)}`,
    `总成本: $${cost.totalCostUsd.toFixed(2)}`,
    `失败风险成本: $${cost.failureRiskCostUsd.toFixed(2)}`,
    `预期总成本: $${cost.expectedTotalCostUsd.toFixed(2)}`,
  ].join('\n');
}
