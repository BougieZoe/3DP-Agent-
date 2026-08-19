import type { UnifiedAnalysis } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Object-context axis: the SAME geometry, printed for different USE CASES, has
// different things that matter. This weights the technology metrics by the
// object's purpose and surfaces the top concerns — e.g. furniture cares about
// strength (wall thickness / delamination), a large structure cares about
// warpage at scale, a jewel cares about detail / surface.
// ─────────────────────────────────────────────────────────────────────────────

export type ObjectContext = 'general' | 'structural' | 'large' | 'detailed';

export interface ContextAssessment {
  /** 0..1 context-weighted overall risk. */
  overallRisk: number;
  /** 0..1 the part-specific risk after weighting. */
  contextWeightedRisk: number;
  /** Human-readable top concerns for this object context. */
  topConcerns: string[];
}

function concern(risk: number | undefined, label: string, threshold = 0.4): string | null {
  return risk !== undefined && risk >= threshold ? `⚠ ${label}` : null;
}

export function assessContext(unified: UnifiedAnalysis, context: ObjectContext): ContextAssessment {
  const metrics = unified.metrics?.result;
  const resin = unified.resin?.result;
  const fgf = unified.fgf?.result;

  // Normalize: min wall thickness (lower = worse), overhang ratio (higher = worse)
  const minWall = metrics?.minWallThicknessMm;
  const wallRisk = minWall != null ? Math.min(1, Math.max(0, (2 - minWall) / 2)) : undefined;
  const overhang = metrics?.overhang?.ratio ?? undefined;

  const concerns: string[] = [];
  let weighted = 0;
  let count = 0;

  const push = (w: number, r: number | undefined) => {
    if (r === undefined) return;
    weighted += w * r;
    count += w;
  };

  switch (context) {
    case 'structural': // furniture / load-bearing
      push(3, wallRisk);
      push(3, overhang);
      push(2, fgf?.delaminationRisk);
      push(1, fgf?.warpageRisk);
      concerns.push(...[concern(wallRisk, 'thin walls are a strength risk', 0.5), concern(fgf?.delaminationRisk, 'layer delamination risk (load-bearing)', 0.5)].filter(Boolean) as string[]);
      break;
    case 'large': // construction / big structures
      push(3, fgf?.warpageRisk);
      push(2, fgf?.delaminationRisk);
      push(2, fgf?.slenderness);
      push(1, overhang);
      concerns.push(...[concern(fgf?.warpageRisk, 'large-part warpage risk', 0.4), concern(fgf?.delaminationRisk, 'layer delamination at scale', 0.4)].filter(Boolean) as string[]);
      break;
    case 'detailed': // jewelry / dental / fine parts
      push(3, resin?.suctionRisk);
      push(2, resin?.islandCount != null ? Math.min(1, resin.islandCount) : undefined);
      push(2, resin?.cureRisk);
      push(1, wallRisk);
      concerns.push(...[concern(resin?.suctionRisk, 'suction will distort fine details', 0.4), concern(resin?.islandCount != null && resin.islandCount > 0 ? 1 : undefined, 'floating islands', 1)].filter(Boolean) as string[]);
      break;
    default: // general
      push(2, wallRisk);
      push(2, overhang);
      push(1, resin?.suctionRisk);
      push(1, fgf?.warpageRisk);
      concerns.push(...[concern(wallRisk, 'thin walls', 0.6), concern(overhang, 'overhangs need support', 0.5)].filter(Boolean) as string[]);
  }

  const overallRisk = count > 0 ? weighted / count : 0;
  if (concerns.length === 0) {
    concerns.push('No major concerns for this object type — looks printable.');
  }
  return { overallRisk, contextWeightedRisk: overallRisk, topConcerns: concerns };
}
