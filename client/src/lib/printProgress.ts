/**
 * Print Progress Detection
 *
 * Estimates 3D print progress from visual features:
 * - Layer height estimation
 * - Filled volume estimation
 * - Remaining height calculation
 */

export interface PrintProgressEstimate {
  /** Estimated percentage complete (0-100) */
  percentage: number;
  /** Estimated layers printed */
  layersPrinted: number;
  /** Total estimated layers */
  totalLayers: number;
  /** Estimated remaining time in minutes */
  remainingMinutes: number;
  /** Confidence in the estimate (0-1) */
  confidence: number;
}

export interface PrintProgressConfig {
  /** Total model height in mm */
  totalHeightMm: number;
  /** Layer height in mm */
  layerHeightMm: number;
  /** Estimated print speed in mm/s */
  printSpeedMmPerSec?: number;
}

/**
 * Estimate print progress from visual analysis
 */
export function estimatePrintProgress(
  currentHeightMm: number,
  config: PrintProgressConfig
): PrintProgressEstimate {
  const { totalHeightMm, layerHeightMm, printSpeedMmPerSec = 50 } = config;

  const totalLayers = Math.ceil(totalHeightMm / layerHeightMm);
  const layersPrinted = Math.floor(currentHeightMm / layerHeightMm);
  const percentage = Math.min(100, (currentHeightMm / totalHeightMm) * 100);

  // Estimate remaining time based on remaining layers
  const remainingLayers = totalLayers - layersPrinted;
  const mmPerLayer = layerHeightMm;
  const timePerLayer = mmPerLayer / printSpeedMmPerSec;
  const remainingSeconds = remainingLayers * timePerLayer;
  const remainingMinutes = remainingSeconds / 60;

  return {
    percentage: Math.round(percentage * 10) / 10,
    layersPrinted,
    totalLayers,
    remainingMinutes: Math.round(remainingMinutes * 10) / 10,
    confidence: 0.7, // Base confidence — visual estimation has uncertainty
  };
}

/**
 * Estimate current height from webcam image analysis
 * This is a placeholder — real implementation would use CV/ML
 */
export function estimateHeightFromImage(
  _imageData: ImageData,
  totalHeightMm: number
): { heightMm: number; confidence: number } {
  // Placeholder: In production, this would use computer vision
  // to detect the current print height from the webcam image.
  // 
  // Possible approaches:
  // 1. Color segmentation to find the printed region
  // 2. Edge detection to find the current layer
  // 3. ML model trained on print progress images
  
  return {
    heightMm: totalHeightMm * 0.5, // Dummy 50% progress
    confidence: 0.3,
  };
}

/**
 * Calculate time-based progress estimate
 * Uses start time and estimated total time
 */
export function estimateProgressFromTime(
  startTimeMs: number,
  estimatedTotalMinutes: number
): PrintProgressEstimate {
  const elapsedMs = Date.now() - startTimeMs;
  const elapsedMinutes = elapsedMs / 60000;
  const percentage = Math.min(100, (elapsedMinutes / estimatedTotalMinutes) * 100);
  const remainingMinutes = Math.max(0, estimatedTotalMinutes - elapsedMinutes);

  return {
    percentage: Math.round(percentage * 10) / 10,
    layersPrinted: 0, // Unknown without layer info
    totalLayers: 0,
    remainingMinutes: Math.round(remainingMinutes * 10) / 10,
    confidence: 0.5, // Time-based is less accurate than visual
  };
}
