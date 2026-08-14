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
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { MetricsResult } from './types';
import { getThresholds, DEFAULT_ANALYSIS_THRESHOLDS, type AnalysisThresholds } from './thresholds';

/**
 * Default layer height (mm). Exported so UI readouts can reference the real
 * default; the value lives in DEFAULT_ANALYSIS_THRESHOLDS.printTime.defaultLayerHeightMm.
 */
export const DEFAULT_LAYER_HEIGHT = DEFAULT_ANALYSIS_THRESHOLDS.printTime.defaultLayerHeightMm;

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
  layerHeightMm?: number,
  densityGPerCm3?: number,
  pricePerKgUsd?: number,
  language: ContentLang = 'en',
  thresholds: AnalysisThresholds = getThresholds(),
): AnalysisModuleResult<PrintTimeResult> {
  const pt = thresholds.printTime;
  const startTime = performance.now();

  const volume = metricsResult.meshVolumeMm3;
  const overhangRatio = metricsResult.overhang.ratio;
  const profile = PRINTER_PROFILES[printerId];

  if (volume <= 0) {
    return moduleResult('printTime', 0.0, 0, {
      estimatedPrintTimeMinutes: 0, estimatedPrintTimeHours: 0,
      materialWeightGrams: 0, materialCostUsd: 0, totalCostUsd: 0,
      layerCount: 0, printerProfile: { id: printerId, name: profile.name, widthMm: profile.widthMm, depthMm: profile.depthMm, heightMm: profile.heightMm },
    }, translate(CONTENT, 'printTime.zeroVolume', language));
  }

  const effectiveLayerHeight = layerHeightMm ?? pt.defaultLayerHeightMm;

  // Pick closest layer height rate
  const layerHeights = Object.keys(pt.volumetricRates).map(Number);
  const closestLh = layerHeights.reduce((prev, curr) =>
    Math.abs(curr - effectiveLayerHeight) < Math.abs(prev - effectiveLayerHeight) ? curr : prev
  );
  const volumetricRate = pt.volumetricRates[closestLh];

  // Base print time from volume
  const baseTimeMinutes = volume / volumetricRate;

  // Overhang penalty: steep overhangs need slower printing
  // Adds up to 50% more time for severe overhangs
  const overhangPenalty = overhangRatio > pt.overhangPenalty.severeRatio ? pt.overhangPenalty.severeMultiplier : overhangRatio > pt.overhangPenalty.moderateRatio ? pt.overhangPenalty.moderateMultiplier : 1.0;

  // Fixed overhead: bed heating, homing, purge line
  const overheadMinutes = pt.overheadMinutes;

  const totalMinutes = Math.round(baseTimeMinutes * overhangPenalty + overheadMinutes);
  const totalHours = parseFloat((totalMinutes / 60).toFixed(1));

  // Layer count
  const maxDim = Math.max(metricsResult.boundingBoxDimensionsMm.x, metricsResult.boundingBoxDimensionsMm.y, metricsResult.boundingBoxDimensionsMm.z);
  const layerCount = Math.ceil(maxDim / effectiveLayerHeight);

  // Material weight
  const volumeCm3 = volume / 1000;
  const weightGrams = volumeCm3 * (densityGPerCm3 ?? 1.24);

  // Cost
  const materialCost = weightGrams / 1000 * (pricePerKgUsd ?? 22);
  const machineCost = totalHours * pt.machineRatePerHourUsd;
  const totalCost = materialCost + machineCost;

  // Confidence: higher for medium volumes, lower for extreme values
  let confidence: Confidence;
  if (volume < pt.confidence.tinyVolumeMm3 || volume > pt.confidence.hugeVolumeMm3) confidence = pt.confidence.low as Confidence;
  else if (volume < pt.confidence.smallVolumeMm3 || volume > pt.confidence.largeVolumeMm3) confidence = pt.confidence.medium as Confidence;
  else confidence = pt.confidence.high as Confidence;

  const result: PrintTimeResult = {
    estimatedPrintTimeMinutes: totalMinutes,
    estimatedPrintTimeHours: totalHours,
    materialWeightGrams: parseFloat(weightGrams.toFixed(1)),
    materialCostUsd: parseFloat(materialCost.toFixed(2)),
    totalCostUsd: parseFloat(totalCost.toFixed(2)),
    layerCount,
    printerProfile: { id: printerId, name: profile.name, widthMm: profile.widthMm, depthMm: profile.depthMm, heightMm: profile.heightMm },
  };

  const explanation = translate(CONTENT, 'printTime.estimate', language, {
    minutes: totalMinutes,
    hours: totalHours,
    layerHeight: effectiveLayerHeight,
    weight: weightGrams.toFixed(1),
    materialCost: materialCost.toFixed(2),
    totalCost: totalCost.toFixed(2),
    layers: layerCount,
  });

  return moduleResult('printTime', confidence, Math.round(performance.now() - startTime), result, explanation);
}
