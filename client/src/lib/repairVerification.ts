/**
 * Repair verification — the single gate between a mesh modification and
 * committing/exporting it.
 *
 * A repair is only acceptable when the SAME deterministic pipeline re-measures
 * the result and no key metric regresses. Improvements are reported separately
 * so "no regression" is never confused with "the repair helped".
 *
 * Measured only: topology/validation/metrics. A better score or agent opinion
 * is not evidence that the geometry improved.
 */

import type { UnifiedAnalysis } from '@/analysis/types';

const EPSILON = 1e-6;

export interface RepairMetricsSnapshot {
  minWallThicknessMm: number | null;
  p5WallThicknessMm: number | null;
  thinWallRatio: number | null;
  isWatertight: boolean | null;
  holeCount: number | null;
  boundaryEdgeCount: number | null;
  nonManifoldEdgeCount: number | null;
  volumeMm3: number | null;
  volumeReliable: boolean | null;
  triangleCount: number | null;
}

export type RepairRegressionCode =
  | 'baseline_unavailable'
  | 'analysis_unavailable'
  | 'non_manifold_increased'
  | 'boundary_increased'
  | 'watertight_lost'
  | 'holes_increased'
  | 'min_wall_decreased'
  | 'p5_wall_decreased'
  | 'volume_unreliable'
  | 'volume_implausible'
  | 'empty_result';

export interface RepairRegression {
  code: RepairRegressionCode;
  message: string;
  before: number | null;
  after: number | null;
}

export type RepairImprovementCode =
  | 'watertight_gained'
  | 'non_manifold_reduced'
  | 'boundary_reduced'
  | 'holes_reduced'
  | 'min_wall_increased'
  | 'p5_wall_increased'
  | 'volume_reliability_gained';

export interface RepairImprovement {
  code: RepairImprovementCode;
  message: string;
}

export interface RepairVerification {
  accepted: boolean;
  regressions: RepairRegression[];
  improvements: RepairImprovement[];
  before: RepairMetricsSnapshot | null;
  after: RepairMetricsSnapshot | null;
  summary: string;
}

/** Extract only the measured facts used by the gate. Missing stays null. */
export function snapshotRepairMetrics(
  analysis: UnifiedAnalysis | null | undefined,
): RepairMetricsSnapshot | null {
  if (!analysis) return null;
  const m = analysis.metrics?.result;
  const v = analysis.validation?.result;
  const t = analysis.topology?.result;
  if (!m && !v && !t) return null;
  return {
    minWallThicknessMm: m?.minWallThicknessMm ?? null,
    p5WallThicknessMm: m?.p5WallThicknessMm ?? null,
    thinWallRatio: m?.thinWallRatio ?? null,
    isWatertight: v?.isWatertight ?? null,
    holeCount: v?.holeCount ?? null,
    boundaryEdgeCount:
      v?.boundaryEdgeCount ?? t?.boundaryEdgeCount ?? null,
    nonManifoldEdgeCount: t?.nonManifoldEdgeCount ?? null,
    volumeMm3: m?.meshVolumeMm3 ?? null,
    volumeReliable: m?.volumeReliable ?? null,
    triangleCount: t?.triangleCount ?? null,
  };
}

function fmt(n: number | null, digits = 3): string {
  return n === null ? 'unknown' : n.toFixed(digits);
}

/**
 * Compare a re-measured repair against its baseline. Any hard regression
 * rejects the modification; the caller must keep the original mesh.
 */
export function verifyRepair(
  beforeAnalysis: UnifiedAnalysis | null | undefined,
  afterAnalysis: UnifiedAnalysis | null | undefined,
): RepairVerification {
  const before = snapshotRepairMetrics(beforeAnalysis);
  const after = snapshotRepairMetrics(afterAnalysis);
  const regressions: RepairRegression[] = [];
  const improvements: RepairImprovement[] = [];

  if (!before) {
    regressions.push({
      code: 'baseline_unavailable',
      message: 'no baseline measurement — repair cannot be verified',
      before: null,
      after: after?.minWallThicknessMm ?? null,
    });
  }
  if (!after) {
    regressions.push({
      code: 'analysis_unavailable',
      message: 're-analysis produced no usable measurements',
      before: before?.minWallThicknessMm ?? null,
      after: null,
    });
  }

  if (before && after) {
    if (after.triangleCount === 0) {
      regressions.push({
        code: 'empty_result',
        message: 'repair produced an empty mesh',
        before: before.triangleCount,
        after: after.triangleCount,
      });
    }

    if (
      after.nonManifoldEdgeCount !== null &&
      after.nonManifoldEdgeCount > (before.nonManifoldEdgeCount ?? 0)
    ) {
      regressions.push({
        code: 'non_manifold_increased',
        message: `non-manifold edges ${fmt(before.nonManifoldEdgeCount, 0)}→${fmt(after.nonManifoldEdgeCount, 0)}`,
        before: before.nonManifoldEdgeCount,
        after: after.nonManifoldEdgeCount,
      });
    } else if (
      before.nonManifoldEdgeCount !== null &&
      after.nonManifoldEdgeCount !== null &&
      after.nonManifoldEdgeCount < before.nonManifoldEdgeCount
    ) {
      improvements.push({
        code: 'non_manifold_reduced',
        message: `non-manifold edges ${fmt(before.nonManifoldEdgeCount, 0)}→${fmt(after.nonManifoldEdgeCount, 0)}`,
      });
    }

    if (
      after.boundaryEdgeCount !== null &&
      after.boundaryEdgeCount > (before.boundaryEdgeCount ?? 0)
    ) {
      regressions.push({
        code: 'boundary_increased',
        message: `boundary edges ${fmt(before.boundaryEdgeCount, 0)}→${fmt(after.boundaryEdgeCount, 0)}`,
        before: before.boundaryEdgeCount,
        after: after.boundaryEdgeCount,
      });
    } else if (
      before.boundaryEdgeCount !== null &&
      after.boundaryEdgeCount !== null &&
      after.boundaryEdgeCount < before.boundaryEdgeCount
    ) {
      improvements.push({
        code: 'boundary_reduced',
        message: `boundary edges ${fmt(before.boundaryEdgeCount, 0)}→${fmt(after.boundaryEdgeCount, 0)}`,
      });
    }

    if (before.isWatertight === true && after.isWatertight === false) {
      regressions.push({
        code: 'watertight_lost',
        message: 'watertightness lost',
        before: 1,
        after: 0,
      });
    } else if (before.isWatertight === false && after.isWatertight === true) {
      improvements.push({ code: 'watertight_gained', message: 'watertight' });
    }

    if (
      after.holeCount !== null &&
      after.holeCount > (before.holeCount ?? 0)
    ) {
      regressions.push({
        code: 'holes_increased',
        message: `holes ${fmt(before.holeCount, 0)}→${fmt(after.holeCount, 0)}`,
        before: before.holeCount,
        after: after.holeCount,
      });
    } else if (
      before.holeCount !== null &&
      after.holeCount !== null &&
      after.holeCount < before.holeCount
    ) {
      improvements.push({
        code: 'holes_reduced',
        message: `holes ${fmt(before.holeCount, 0)}→${fmt(after.holeCount, 0)}`,
      });
    }

    if (
      before.minWallThicknessMm !== null &&
      after.minWallThicknessMm !== null &&
      after.minWallThicknessMm < before.minWallThicknessMm - EPSILON
    ) {
      regressions.push({
        code: 'min_wall_decreased',
        message: `min wall ${fmt(before.minWallThicknessMm)}→${fmt(after.minWallThicknessMm)}mm`,
        before: before.minWallThicknessMm,
        after: after.minWallThicknessMm,
      });
    } else if (
      before.minWallThicknessMm !== null &&
      after.minWallThicknessMm !== null &&
      after.minWallThicknessMm > before.minWallThicknessMm + EPSILON
    ) {
      improvements.push({
        code: 'min_wall_increased',
        message: `min wall ${fmt(before.minWallThicknessMm)}→${fmt(after.minWallThicknessMm)}mm`,
      });
    }

    if (
      before.p5WallThicknessMm !== null &&
      after.p5WallThicknessMm !== null &&
      after.p5WallThicknessMm < before.p5WallThicknessMm - EPSILON
    ) {
      regressions.push({
        code: 'p5_wall_decreased',
        message: `p5 wall ${fmt(before.p5WallThicknessMm)}→${fmt(after.p5WallThicknessMm)}mm`,
        before: before.p5WallThicknessMm,
        after: after.p5WallThicknessMm,
      });
    } else if (
      before.p5WallThicknessMm !== null &&
      after.p5WallThicknessMm !== null &&
      after.p5WallThicknessMm > before.p5WallThicknessMm + EPSILON
    ) {
      improvements.push({
        code: 'p5_wall_increased',
        message: `p5 wall ${fmt(before.p5WallThicknessMm)}→${fmt(after.p5WallThicknessMm)}mm`,
      });
    }

    if (before.volumeReliable === true && after.volumeReliable === false) {
      regressions.push({
        code: 'volume_unreliable',
        message: 'volume became unreliable (open shell)',
        before: 1,
        after: 0,
      });
    } else if (before.volumeReliable === false && after.volumeReliable === true) {
      improvements.push({ code: 'volume_reliability_gained', message: 'volume reliable' });
    }

    if (
      before.volumeMm3 !== null &&
      after.volumeMm3 !== null &&
      before.volumeMm3 > 0
    ) {
      const ratio = after.volumeMm3 / before.volumeMm3;
      if (ratio < 0.25 || ratio > 4) {
        regressions.push({
          code: 'volume_implausible',
          message: `volume changed ${fmt(before.volumeMm3, 0)}→${fmt(after.volumeMm3, 0)}mm³ (${ratio.toFixed(2)}×)`,
          before: before.volumeMm3,
          after: after.volumeMm3,
        });
      }
    }
  }

  const accepted = before !== null && after !== null && regressions.length === 0;
  let summary: string;
  if (!accepted) {
    summary = `repair rejected: ${regressions.map((r) => r.message).join('; ')}`;
  } else if (improvements.length > 0) {
    summary = `repair verified: ${improvements.map((i) => i.message).join('; ')}`;
  } else {
    summary = 'repair verified: no measured regression (no key metric improved)';
  }

  return { accepted, regressions, improvements, before, after, summary };
}
