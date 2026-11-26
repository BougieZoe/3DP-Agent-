/**
 * Cost Calculator
 *
 * Calculates cost breakdown from analysis results.
 * Provides detailed cost estimation for printing.
 */

import type { UnifiedAnalysis, CostBreakdown } from './types';
import { CONTENT, translate } from '@shared/i18n/content';
import type { ContentLang } from '@shared/i18n/content';

// Default cost rates
const DEFAULT_PRINT_TIME_RATE_USD_PER_HOUR = 2.0;
const DEFAULT_SUPPORT_COST_USD_PER_GRAM = 0.02;
const DEFAULT_POST_PROCESSING_COST_USD = 0;

/**
 * Calculate cost breakdown from analysis results.
 */
export function calculateCostBreakdown(analysis: UnifiedAnalysis): CostBreakdown {
  const printTime = analysis.printTime?.result;
  const support = analysis.support?.result;
  const thermal = analysis.thermal?.result;

  // Material cost
  const materialCostUsd = printTime?.materialCostUsd ?? 0;

  // Print time cost
  const printTimeHours = printTime?.estimatedPrintTimeHours ?? 0;
  const printTimeCostUsd = printTimeHours * DEFAULT_PRINT_TIME_RATE_USD_PER_HOUR;

  // Support cost
  const supportGrams = support?.estimatedSupportGrams ?? 0;
  const supportCostUsd = supportGrams * DEFAULT_SUPPORT_COST_USD_PER_GRAM;

  // Post-processing cost (placeholder)
  const postProcessingCostUsd = DEFAULT_POST_PROCESSING_COST_USD;

  // Total cost
  const totalCostUsd = materialCostUsd + printTimeCostUsd + supportCostUsd + postProcessingCostUsd;

  // Failure risk cost
  const warpingRiskScore = thermal?.warpingRiskScore ?? 0;
  const failureRiskCostUsd = warpingRiskScore * materialCostUsd * 0.5;

  // Expected total cost (including risk)
  const expectedTotalCostUsd = totalCostUsd + failureRiskCostUsd;

  return {
    materialCostUsd,
    printTimeCostUsd,
    supportCostUsd,
    postProcessingCostUsd,
    totalCostUsd,
    failureRiskCostUsd,
    expectedTotalCostUsd,
  };
}

/**
 * Format cost breakdown for display.
 */
export function formatCostBreakdown(cost: CostBreakdown, lang: ContentLang = 'en'): string {
  const lines = [
    translate(CONTENT, 'cost.line.material', lang, { amount: `$${cost.materialCostUsd.toFixed(2)}` }),
    translate(CONTENT, 'cost.line.printTime', lang, { amount: `$${cost.printTimeCostUsd.toFixed(2)}` }),
    translate(CONTENT, 'cost.line.support', lang, { amount: `$${cost.supportCostUsd.toFixed(2)}` }),
    translate(CONTENT, 'cost.line.postProcessing', lang, { amount: `$${cost.postProcessingCostUsd.toFixed(2)}` }),
    translate(CONTENT, 'cost.line.total', lang, { amount: `$${cost.totalCostUsd.toFixed(2)}` }),
    translate(CONTENT, 'cost.line.failureRisk', lang, { amount: `$${cost.failureRiskCostUsd.toFixed(2)}` }),
    translate(CONTENT, 'cost.line.expectedTotal', lang, { amount: `$${cost.expectedTotalCostUsd.toFixed(2)}` }),
  ];

  return lines.join('\n');
}
