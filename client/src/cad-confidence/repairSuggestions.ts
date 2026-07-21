import type { UnifiedAnalysis, OverhangSeverity, SupportDifficulty } from '@/analysis';
import type { RepairSuggestion, Issue } from './types';

export function generateRepairSuggestions(analysis: UnifiedAnalysis): RepairSuggestion[] {
  const suggestions: RepairSuggestion[] = [];
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;
  const v = analysis.validation?.result;
  const sp = analysis.support?.result;
  const bf = analysis.bedFit?.result;

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  if (sev === 'severe') {
    suggestions.push({ action: 'Reduce overhang angle', description: 'Overhangs >45° require supports. Flatten steep faces or split the model into parts that print without bridging.', impact: 'high', category: 'overhang' });
  }

  const thinRatio = m?.thinWallRatio ?? 0;
  if (thinRatio > 0.3) {
    suggestions.push({ action: 'Increase wall thickness', description: `${(thinRatio * 100).toFixed(0)}% of surface has walls <0.8mm. Thicken to at least 1.2mm for structural integrity and reliable printing.`, impact: 'high', category: 'wall_thickness' });
  } else if (thinRatio > 0.1) {
    suggestions.push({ action: 'Reinforce thin walls', description: `${(thinRatio * 100).toFixed(0)}% of surface is thin. Consider thickening problem areas to at least 1.0mm.`, impact: 'medium', category: 'wall_thickness' });
  }

  if (!t?.isManifold) {
    suggestions.push({ action: 'Repair non-manifold geometry', description: 'Non-manifold edges cause slicing errors. Use mesh repair tools (netfabb, PrusaSlicer) to fix problem edges.', impact: 'high', category: 'geometry' });
  }

  if (v != null && !v.isWatertight && v.holeCount > 0) {
    suggestions.push({ action: 'Close mesh holes', description: `${v.holeCount} holes detected. Watertight mesh is required for slicing. Use hole-filling tools in your CAD software.`, impact: 'high', category: 'geometry' });
  }

  if (bf != null && !bf.fits) {
    suggestions.push({ action: 'Rotate or scale to fit build plate', description: `Model exceeds ${bf.printerProfile.name} bed (${bf.printerProfile.widthMm}×${bf.printerProfile.depthMm}×${bf.printerProfile.heightMm}mm). Try 45° rotation or uniform scaling.`, impact: 'medium', category: 'scale' });
  }

  const diff = sp?.difficulty as SupportDifficulty | undefined;
  if (diff === 'very_difficult' || diff === 'difficult') {
    suggestions.push({ action: 'Reduce support complexity', description: 'Complex supports increase print time and post-processing. Consider splitting the model or redesigning overhanging features to be self-supporting.', impact: 'medium', category: 'support' });
  }

  if (sp != null && sp.largestRegionRatio > 0.5) {
    suggestions.push({ action: 'Optimize print orientation', description: 'Large contiguous support region suggests suboptimal orientation. Rotate to minimize total overhang area.', impact: 'medium', category: 'orientation' });
  }

  if (t != null && t.shellCount > 1) {
    suggestions.push({ action: 'Merge disconnected components', description: `${t.shellCount} disconnected shells detected. If these should be a single part, use boolean union operations.`, impact: 'low', category: 'geometry' });
  }

  if (sev === 'moderate') {
    suggestions.push({ action: 'Add gradual overhang transitions', description: 'Moderate overhangs benefit from chamfered or filleted transitions that reduce the effective overhang angle.', impact: 'low', category: 'overhang' });
  }

  return suggestions;
}

export function buildIssuesFromSuggestions(_suggestions: RepairSuggestion[], analysis: UnifiedAnalysis): Issue[] {
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;
  const v = analysis.validation?.result;
  const sp = analysis.support?.result;
  const issues: Issue[] = [];

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  if (sev === 'severe') issues.push({ severity: 'error', message: 'Severe overhang — supports required' });
  else if (sev === 'moderate') issues.push({ severity: 'warning', message: 'Moderate overhang may need supports', suggestion: 'Use paint-on supports in slicer' });

  if (!t?.isManifold) issues.push({ severity: 'error', message: 'Non-manifold mesh — may cause slicing errors', suggestion: 'Run mesh repair' });

  if (v != null && !v.isWatertight) issues.push({ severity: 'error', message: 'Mesh is not watertight (has holes)', suggestion: 'Close mesh holes in CAD' });

  const thinRatio = m?.thinWallRatio ?? 0;
  if (thinRatio > 0.3) issues.push({ severity: 'error', message: `Thin walls on ${(thinRatio * 100).toFixed(0)}% of surface`, suggestion: 'Increase wall thickness to ≥1.2mm' });
  else if (thinRatio > 0.1) issues.push({ severity: 'warning', message: `Some thin walls (${(thinRatio * 100).toFixed(0)}% of surface)`, suggestion: 'Reinforce problem areas' });

  const diff = sp?.difficulty as SupportDifficulty | undefined;
  if (diff === 'very_difficult') issues.push({ severity: 'warning', message: 'Very difficult support structure required', suggestion: 'Split model or redesign overhangs' });
  else if (diff === 'difficult') issues.push({ severity: 'info', message: 'Complex support structure needed', suggestion: 'Consider print orientation' });

  return issues;
}
