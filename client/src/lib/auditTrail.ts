/**
 * Audit trail — every point of the printability score, traced to its rule.
 *
 * Mirrors getTrafficLight (the single writer of the score) deduction by
 * deduction. If a deduction changes there, the matching row here must change
 * too — the consistency test below the suite enforces
 * score + deductions == 100 (pre-clamp).
 */

import type { UnifiedAnalysis } from '../analysis/types';
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from '@/analysis/metrics';
import { getTrafficLight } from '../components/reportUtils';

/** Bump when the deduction table changes. Auditors pin this. */
export const RULES_VERSION = 1;

export interface AuditRow {
  rule: string;
  input: string;
  deduction: number;
  status: 'pass' | 'warn' | 'fail' | 'skip';
}

export interface AuditTrail {
  rulesVersion: number;
  score: number;
  light: string;
  rows: AuditRow[];
}

export function buildAuditTrail(analysis: UnifiedAnalysis): AuditTrail {
  const { light, score } = getTrafficLight(analysis);
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;
  const rows: AuditRow[] = [];

  if (v) {
    rows.push({
      rule: 'WATERTIGHT', input: `isWatertight=${v.isWatertight}`,
      deduction: v.isWatertight ? 0 : 30, status: v.isWatertight ? 'pass' : 'fail',
    });
    rows.push({
      rule: 'HOLES', input: `holeCount=${v.holeCount}`,
      deduction: v.holeCount > 0 ? v.holeCount * 8 : 0,
      status: v.holeCount > 0 ? 'fail' : 'pass',
    });
    rows.push({
      rule: 'FLIPPED_NORMALS', input: `flippedNormalRatio=${v.flippedNormalRatio}`,
      deduction: v.flippedNormalRatio > 0.1 ? 15 : 0,
      status: v.flippedNormalRatio > 0.1 ? 'fail' : 'pass',
    });
    rows.push({
      rule: 'DEGENERATE_FACES', input: `degenerateFaceCount=${v.degenerateFaceCount}`,
      deduction: v.degenerateFaceCount > 10 ? 10 : 0,
      status: v.degenerateFaceCount > 10 ? 'fail' : 'pass',
    });
  } else {
    rows.push({ rule: 'VALIDATION', input: 'module absent', deduction: 0, status: 'skip' });
  }

  if (m) {
    const wt = deriveWtStatus(m.thinWallRatio ?? 0, m.p5WallThicknessMm);
    rows.push({
      rule: 'THIN_WALL', input: `thinWallRatio=${m.thinWallRatio ?? 0}, p5=${m.p5WallThicknessMm}`,
      deduction: wt === 'critical' ? 30 : wt === 'warning' ? 15 : 0,
      status: wt === 'critical' ? 'fail' : wt === 'warning' ? 'warn' : 'pass',
    });
    const lowConf = (m.averageConfidence ?? 0) < 0.3 && (m.thinWallRatio ?? 0) < 0.02;
    rows.push({
      rule: 'LOW_CONFIDENCE', input: `averageConfidence=${m.averageConfidence}`,
      deduction: lowConf ? 3 : 0, status: lowConf ? 'warn' : 'pass',
    });
    const oh = deriveOhStatus(m.overhang.ratio);
    rows.push({
      rule: 'OVERHANG', input: `overhangRatio=${m.overhang.ratio}`,
      deduction: oh === 'critical' ? 20 : oh === 'warning' ? 10 : 0,
      status: oh === 'critical' ? 'fail' : oh === 'warning' ? 'warn' : 'pass',
    });
  } else {
    rows.push({ rule: 'METRICS', input: 'module absent', deduction: 0, status: 'skip' });
  }

  if (s) {
    const st = deriveSupportStatus(s);
    rows.push({
      rule: 'SUPPORT', input: `status=${st.status}`,
      deduction: st.status === 'critical' ? 20 : st.status === 'warning' ? 10 : 0,
      status: st.status === 'critical' ? 'fail' : st.status === 'warning' ? 'warn' : 'pass',
    });
  } else {
    rows.push({ rule: 'SUPPORT', input: 'module absent', deduction: 0, status: 'skip' });
  }

  return { rulesVersion: RULES_VERSION, score, light, rows };
}
