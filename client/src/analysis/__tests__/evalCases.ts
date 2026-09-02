/**
 * EVAL_CASES — real-pipeline evaluation set for analysis thresholds.
 *
 * Each case runs the REAL `runAnalysisPipeline` and records the wall-confidence
 * verdict, so we can see empirically what actually happens — not guess. Used as
 * a regression baseline for confidence/trusted decisions.
 *
 * Contract:
 *  - The healthy cube MUST resolve to exactly 0.4 (asserted hard in the test).
 *    That is the trusted baseline that must never regress.
 *  - Cases that show a banner (thin wall, unmeasurable open shell) must KEEP
 *    showing it — coverage must not relax.
 */

import { runAnalysisPipeline, type PipelineOptions } from '../pipeline';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { isWallConfidenceTrusted } from '../verdict';
import type { GeometryModel } from '../geometryModel';
import {
  createWatertightCube,
  createThinWall,
  createOverhangPlate,
  createOpenCube,
  createIcosphere,
  createTerrainGrid,
} from './testMeshes';

export interface EvalCase {
  /** Stable id — referenced by calibration notes. */
  id: string;
  /** Short human description. */
  label: string;
  /** The mesh (already a GeometryModel, e.g. createWatertightCubeModel()). */
  build: () => GeometryModel;
  /**
   * Expected wall-confidence verdict under the CURRENT (pre-calibration)
   * thresholds. `trusted: true` means isWallConfidenceTrusted(confidence)
   * must hold; `false` means it must NOT hold.
   */
  expectTrusted: boolean;
  /** Optional exact confidence the case must produce (e.g. cube === 0.4). */
  expectConfidence?: number;
}

/** Cases that must never be mis-classified after calibration either. */
export const EVAL_CASES: EvalCase[] = [
  {
    id: 'cube',
    label: 'watertight solid cube (healthy baseline)',
    build: () => fromThreeBufferGeometry(createWatertightCube()),
    expectTrusted: true,
    expectConfidence: 0.4,
  },
  {
    id: 'cube-large',
    label: 'watertight cube scaled to 100mm (healthy large part)',
    build: () => {
      const g = createWatertightCube();
      g.scale(100, 100, 100);
      return fromThreeBufferGeometry(g);
    },
    expectTrusted: true,
    expectConfidence: 0.4,
  },
  {
    id: 'icosphere',
    label: 'solid icosphere (healthy organic shape)',
    build: () => fromThreeBufferGeometry(createIcosphere(0)),
    expectTrusted: true,
  },
  {
    id: 'thin-wall',
    label: '0.4mm thin wall (must show banner)',
    build: () => fromThreeBufferGeometry(createThinWall(10)),
    expectTrusted: false,
  },
  {
    id: 'overhang-plate',
    label: 'overhanging plate (support-relevant; single-surface, wall unmeasurable → banner)',
    build: () => fromThreeBufferGeometry(createOverhangPlate(100, 100, 60)),
    expectTrusted: false,
  },
  {
    id: 'open-cube',
    label: 'open cube — not watertight, but opposing walls still measurable',
    build: () => fromThreeBufferGeometry(createOpenCube()),
    expectTrusted: true,
    expectConfidence: 0.4,
  },
  {
    id: 'terrain',
    label: 'open terrain surface (wall measurement not meaningful)',
    build: () => fromThreeBufferGeometry(createTerrainGrid(10, 20, 20)),
    expectTrusted: false,
  },
];

export interface EvalObservation {
  caseId: string;
  label: string;
  confidence: number;
  trusted: boolean;
  sampleCount: number;
  thinWallRatio: number;
  minWallThicknessMm: number | null;
  averageConfidence: number;
}

/** Run the REAL pipeline for every case and collect wall-confidence facts. */
export function runEvalCases(options: PipelineOptions = {}): EvalObservation[] {
  return EVAL_CASES.map((c) => {
    const ua = runAnalysisPipeline(c.build(), options);
    const m = ua.metrics.result;
    return {
      caseId: c.id,
      label: c.label,
      confidence: ua.metrics.confidence,
      trusted: isWallConfidenceTrusted(ua.metrics.confidence),
      sampleCount: m.wallThicknessSamples.length,
      thinWallRatio: m.thinWallRatio,
      minWallThicknessMm: m.minWallThicknessMm,
      averageConfidence: m.averageConfidence,
    };
  });
}

/** Human-readable table for reporting calibration results. */
export function formatEvalTable(rows: EvalObservation[]): string {
  const header = ['case', 'conf', 'trusted', 'samples', 'thinWallRatio', 'minWall'];
  const w = header.map((h, i) => Math.max(h.length, ...rows.map(r => String([
    r.caseId, r.confidence.toFixed(2), r.trusted,
    r.sampleCount, r.thinWallRatio.toFixed(3),
    r.minWallThicknessMm === null ? '—' : r.minWallThicknessMm.toFixed(3),
  ][i]).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(w[i])).join('  ');
  return [
    line(header),
    rows.map(r => line([r.caseId, r.confidence.toFixed(2), String(r.trusted), String(r.sampleCount), r.thinWallRatio.toFixed(3), r.minWallThicknessMm === null ? '—' : r.minWallThicknessMm.toFixed(3)])),
  ].flat().join('\n');
}
