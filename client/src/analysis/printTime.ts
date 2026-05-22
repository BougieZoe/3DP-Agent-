/**
 * Print Time & Cost Estimator
 *
 * Estimates print time and material cost based on mesh geometry.
 *
 * Estimation model:
 * - Print time = (volume / volumetric_rate) + (overhang_penalty) + fixed_overhead
 * - Volumetric rate depends on layer height, nozzle diameter, and print speed
 * - Overhang penalty adds time for slower printing on steep faces
 *
 * Limitations:
 * - Does not account for infill patterns, wall layers, or top/bottom shells.
 * - Travel time, retraction, and bed leveling are not included.
 * - Different materials and nozzle sizes have different optimal rates.
 * - The volumetric rate is a rough average — real prints vary significantly.
 */

import { moduleResult, PRINTER_PROFILES, type AnalysisModuleResult, type Confidence, type PrintTimeResult, type PrinterProfileId } from './types';
import type { MetricsResult } from './types';

const PLA_DENSITY_G_PER_CM3 = 1.24;
const PLA_PRICE_PER_KG_USD = 22;
const MACHINE_RATE_PER_HOUR_USD = 2;

// Default volumetric print rates (mm³/min) for various layer heights
// Assumes 0.4mm nozzle, moderate quality settings
const VOLUMETRIC_RATES: Record<number, number> = {
  0.05: 120,   // SLA-like resolution
  0.1: 240,    // Fine detail
  0.16: 384,   // Standard quality
  0.2: 480,    // Standard
  0.28: 672,   // Draft
  0.32: 768,   // Fast draft
};

const DEFAULT_LAYER_HEIGHT = 0.2;

/**
 * Estimate print time and cost.
 *
 * @param metricsResult - Pre-computed geometry metrics.
 * @param printerId - Printer profile ID (used for bed dimensions, not speed).
 * @param layerHeightMm - Layer height in mm (default 0.2).
 * @returns PrintTimeResult with estimated time, material, and cost.
 */
export function estimatePrintTime(
  metricsResult: MetricsResult,
  printerId: PrinterProfileId = 'bambu_x1c',
  layerHeightMm: number = DEFAULT_LAYER_HEIGHT,
): AnalysisModuleResult<PrintTimeResult> {
  const startTime = performance.now();

  const volume = metricsResult.meshVolumeMm3;
  const overhangRatio = metricsResult.overhang.ratio;
  const profile = PRINTER_PROFILES[printerId];

  if (volume <= 0) {
    return moduleResult('printTime', 0.0, 0, {
      estimatedPrintTimeMinutes: 0, estimatedPrintTimeHours: 0,
      materialWeightGrams: 0, materialCostUsd: 0, totalCostUsd: 0,
      layerCount: 0, printerProfile: { id: printerId, name: profile.name, widthMm: profile.widthMm, depthMm: profile.depthMm, heightMm: profile.heightMm },
    }, 'Cannot estimate: zero volume');
  }

  // Pick closest layer height rate
  const layerHeights = Object.keys(VOLUMETRIC_RATES).map(Number);
  const closestLh = layerHeights.reduce((prev, curr) =>
    Math.abs(curr - layerHeightMm) < Math.abs(prev - layerHeightMm) ? curr : prev
  );
  const volumetricRate = VOLUMETRIC_RATES[closestLh];

  // Base print time from volume
  const baseTimeMinutes = volume / volumetricRate;

  // Overhang penalty: steep overhangs need slower printing
  // Adds up to 50% more time for severe overhangs
  const overhangPenalty = overhangRatio > 0.3 ? 1.5 : overhangRatio > 0.15 ? 1.25 : 1.0;

  // Fixed overhead: bed heating, homing, purge line
  const overheadMinutes = 5;

  const totalMinutes = Math.round(baseTimeMinutes * overhangPenalty + overheadMinutes);
  const totalHours = parseFloat((totalMinutes / 60).toFixed(1));

  // Layer count
  const maxDim = Math.max(metricsResult.boundingBoxDimensionsMm.x, metricsResult.boundingBoxDimensionsMm.y, metricsResult.boundingBoxDimensionsMm.z);
  const layerCount = Math.ceil(maxDim / layerHeightMm);

  // Material weight
  const volumeCm3 = volume / 1000;
  const weightGrams = volumeCm3 * PLA_DENSITY_G_PER_CM3;

  // Cost
  const materialCost = weightGrams / 1000 * PLA_PRICE_PER_KG_USD;
  const machineCost = totalHours * MACHINE_RATE_PER_HOUR_USD;
  const totalCost = materialCost + machineCost;

  // Confidence: higher for medium volumes, lower for extreme values
  let confidence: Confidence;
  if (volume < 100 || volume > 10000000) confidence = 0.3 as Confidence;
  else if (volume < 1000 || volume > 1000000) confidence = 0.5 as Confidence;
  else confidence = 0.6 as Confidence;

  const result: PrintTimeResult = {
    estimatedPrintTimeMinutes: totalMinutes,
    estimatedPrintTimeHours: totalHours,
    materialWeightGrams: parseFloat(weightGrams.toFixed(1)),
    materialCostUsd: parseFloat(materialCost.toFixed(2)),
    totalCostUsd: parseFloat(totalCost.toFixed(2)),
    layerCount,
    printerProfile: { id: printerId, name: profile.name, widthMm: profile.widthMm, depthMm: profile.depthMm, heightMm: profile.heightMm },
  };

  const explanation = `Est. ${totalMinutes}min (${totalHours}h) at ${layerHeightMm}mm layer height. Material: ${weightGrams.toFixed(1)}g ($${materialCost.toFixed(2)}). Total cost: $${totalCost.toFixed(2)}. ${layerCount} layers.`;

  return moduleResult('printTime', confidence, Math.round(performance.now() - startTime), result, explanation);
}
