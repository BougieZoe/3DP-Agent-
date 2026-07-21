import type { UnifiedAnalysis, OverhangSeverity, SupportDifficulty, SupportResult, BedFitResult } from '@/analysis';
import type { ConfidenceCategory, ConfidenceExplanation, Impact, Issue, RepairSuggestion } from './types';

export function computeCategories(analysis: UnifiedAnalysis): ConfidenceCategory[] {
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;
  const v = analysis.validation?.result;
  const sp = analysis.support?.result;
  const bf = analysis.bedFit?.result;

  return [
    computeTopologyCategory(t),
    computeValidationCategory(v),
    computeGeometryCategory(m),
    computePrintabilityCategory(m, sp, bf),
  ];
}

export function computeOverallScore(categories: ConfidenceCategory[]): number {
  const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = categories.reduce((s, c) => s + c.score * c.weight, 0);
  return Math.round(weighted / totalWeight);
}

export function computeVerdict(score: number, hasFailedChecks: boolean, hasWarningChecks: boolean): import('./types').Verdict {
  if (score >= 80 && !hasFailedChecks) return 'PASS';
  if (score >= 50 && !hasFailedChecks) return 'WARN';
  if (score >= 30 && !hasFailedChecks) return 'WARN';
  return 'FAIL';
}

export function buildIssuesFromCategories(categories: ConfidenceCategory[]): import('./types').Issue[] {
  const issues: import('./types').Issue[] = [];
  for (const cat of categories) {
    for (const msg of cat.issues) {
      const severity = cat.score < 50 ? 'error' : cat.score < 75 ? 'warning' : 'info';
      issues.push({ severity, message: `[${cat.label}] ${msg}` });
    }
  }
  return issues;
}

function computeTopologyCategory(t: UnifiedAnalysis['topology']['result'] | undefined): ConfidenceCategory {
  const issues: string[] = [];
  let score = 0;
  if (t?.isManifold) { score += 40; } else { issues.push('Non-manifold mesh'); }
  if (t?.shellCount != null && t.shellCount <= 1) { score += 30; } else if (t?.shellCount != null) { issues.push(`${t.shellCount} disconnected shells`); }
  if (t?.triangleCount != null && t.triangleCount >= 50) { score += 30; } else { issues.push('Very low triangle count'); }
  return { id: 'topology', label: 'Topology', score, weight: 0.15, issues };
}

function computeValidationCategory(v: UnifiedAnalysis['validation']['result'] | undefined): ConfidenceCategory {
  const issues: string[] = [];
  let score = 0;
  if (v?.isWatertight) { score += 50; } else { issues.push('Mesh is not watertight'); }
  if (v?.holeCount != null && v.holeCount === 0) { score += 30; } else if (v?.holeCount != null && v.holeCount > 0) { issues.push(`${v.holeCount} holes detected`); }
  if (v?.flippedNormalRatio != null && v.flippedNormalRatio < 0.05) { score += 20; } else { issues.push('Flipped normals detected'); }
  return { id: 'validation', label: 'Validation', score, weight: 0.15, issues };
}

function computeGeometryCategory(m: UnifiedAnalysis['metrics']['result'] | undefined): ConfidenceCategory {
  const issues: string[] = [];
  let score = 0;

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  if (sev === 'none' || sev == null) { score += 35; }
  else if (sev === 'moderate') { score += 20; issues.push('Moderate overhang'); }
  else { score += 5; issues.push('Severe overhang'); }

  const thinRatio = m?.thinWallRatio ?? 0;
  if (thinRatio <= 0.05) { score += 35; }
  else if (thinRatio <= 0.2) { score += 20; issues.push('Some thin walls'); }
  else { score += 5; issues.push('Extensive thin walls'); }

  if (m?.meshVolumeMm3 != null && m.meshVolumeMm3 > 0) { score += 30; }
  else { issues.push('Zero or negative volume'); }

  return { id: 'geometry', label: 'Geometry', score, weight: 0.30, issues };
}

function computePrintabilityCategory(
  m: UnifiedAnalysis['metrics']['result'] | undefined,
  sp: SupportResult | null | undefined,
  bf: BedFitResult | null | undefined,
): ConfidenceCategory {
  const issues: string[] = [];
  let score = 0;

  const diff = sp?.difficulty as SupportDifficulty | undefined;
  if (diff === 'none' || diff == null) { score += 35; }
  else if (diff === 'easy') { score += 25; }
  else if (diff === 'moderate') { score += 15; issues.push('Moderate support needed'); }
  else { score += 0; issues.push('Complex support required'); }

  if (bf?.fits) { score += 35; }
  else if (bf != null) { issues.push('Model exceeds printer bed'); }

  if (m?.meshVolumeMm3 != null && m.meshVolumeMm3 < 500000) { score += 30; }
  else { issues.push('Large print volume — long print time expected'); }

  return { id: 'printability', label: 'Printability', score, weight: 0.30, issues };
}

export function generateExplanation(
  categories: ConfidenceCategory[],
  issues: Issue[],
  repairSuggestions: RepairSuggestion[],
  aggregatedRiskScore: number,
): ConfidenceExplanation {
  const failureProbability = Math.min(100, Math.max(0, aggregatedRiskScore));

  const sorted = [...categories].sort((a, b) => a.score - b.score);
  const topRisks = sorted
    .filter(c => c.score < 75 && c.issues.length > 0)
    .slice(0, 3)
    .map(c => {
      const impact: Impact = c.score < 50 ? 'high' : c.score < 75 ? 'medium' : 'low';
      return { reason: c.issues[0], impact, category: c.id };
    });

  let recommendedAction = 'Model appears manufacturable. Consider running a test print.';
  if (repairSuggestions.length > 0) {
    const best = [...repairSuggestions].sort((a, b) => {
      const ord: Record<Impact, number> = { high: 3, medium: 2, low: 1 };
      return ord[b.impact] - ord[a.impact];
    })[0];
    recommendedAction = `${best.action}. ${best.description.split('.')[0]}.`;
  } else if (failureProbability > 30 && topRisks.length > 0) {
    recommendedAction = 'Review highlighted issues and consider adjusting design parameters before printing.';
  } else if (failureProbability > 50) {
    recommendedAction = 'Significant design issues detected. Consider regenerating with modified parameters.';
  }

  return { failureProbability, topRisks, recommendedAction };
}
