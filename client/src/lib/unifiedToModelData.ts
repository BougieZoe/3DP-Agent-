/**
 * Unified → ModelData conversion.
 *
 * Previously duplicated in Home.tsx and printReviewWorkflow.ts with a fabricated
 * `wallThickness.areas = Math.floor(triCount * 0.15)` that had zero relation to
 * the actual raycast thin-wall measurement.  Now a single source of truth that
 * uses the real `thinWallCount` from the analysis pipeline.
 */

import type { UnifiedAnalysis } from '@/analysis';
import type { ModelData } from '@/lib/ruleEngine';
import { deriveOhStatus, deriveWtStatus } from '@/analysis/metrics';
import { DEFAULT_MATERIAL } from '@shared/domain/material';
import type { Material } from '@shared/domain/material';

export function unifiedToModelData(
  unifiedAnalysis: UnifiedAnalysis,
  fileName: string,
  overhangThreshold: number = DEFAULT_MATERIAL.overhangThreshold,
): ModelData {
  const metrics = unifiedAnalysis.metrics.result;
  const topology = unifiedAnalysis.topology.result;
  const volume = metrics?.meshVolumeMm3 ?? metrics?.boundingBoxVolumeMm3 ?? 0;
  const surfaceArea = metrics?.surfaceAreaMm2 ?? 0;
  const oh = metrics?.overhang;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const thinWallRatio = metrics?.thinWallRatio ?? 0;
  const p5Thickness = metrics?.p5WallThicknessMm;
  const minWall = metrics?.minWallThicknessMm;
  const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);

  return {
    fileName,
    wallThickness: {
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      areas: metrics?.thinWallCount ?? 0,
      status: wtStatus,
    },
    overhang: {
      angle: overhangThreshold,
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.ratio ?? 0),
    },
    volume,
    surfaceArea,
    dims,
  };
}

/**
 * Convenience overload: when the caller has a Material object, use its
 * overhang threshold directly.
 */
export function unifiedToModelDataFromMaterial(
  unifiedAnalysis: UnifiedAnalysis,
  fileName: string,
  material: Material,
): ModelData {
  return unifiedToModelData(unifiedAnalysis, fileName, material.overhangThreshold);
}
