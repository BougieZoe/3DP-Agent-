/**
 * Cheapest-next-step — SINGLE WRITER (Agent Contract rule 3).
 * Report PDF, quote text and handoff.json all read from here.
 * Rule: open shell → repair; thin walls (≥20%) → scale/SLA; else → supports.
 * Green verdicts → none.
 */
import type { UnifiedAnalysis } from '../analysis/types';
import { getTrafficLight } from '../components/reportUtils';

export type CheapestStep = 'repair' | 'scale' | 'support' | 'none';

export function cheapestStep(analysis: UnifiedAnalysis): CheapestStep {
  const { light } = getTrafficLight(analysis);
  if (light === 'green') return 'none';
  const v = analysis.validation?.result;
  if (v && !v.isWatertight) return 'repair';
  const twr = analysis.metrics?.result?.thinWallRatio ?? 0;
  if (twr >= 0.2) return 'scale';
  return 'support';
}
