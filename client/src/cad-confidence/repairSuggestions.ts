import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis, OverhangSeverity, SupportDifficulty } from '@/analysis';
import type { RepairSuggestion, Issue } from './types';

export function generateRepairSuggestions(analysis: UnifiedAnalysis, language: ContentLang = 'en'): RepairSuggestion[] {
  const suggestions: RepairSuggestion[] = [];
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;
  const v = analysis.validation?.result;
  const sp = analysis.support?.result;
  const bf = analysis.bedFit?.result;

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  if (sev === 'severe') {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.reduceOverhang.action', language), description: translate(CONTENT, 'cad.repair.reduceOverhang.desc', language), impact: 'high', category: 'overhang' });
  }

  const thinRatio = m?.thinWallRatio ?? 0;
  if (thinRatio > 0.3) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.thickenWall.action', language), description: translate(CONTENT, 'cad.repair.thickenWall.desc', language, { pct: (thinRatio * 100).toFixed(0) }), impact: 'high', category: 'wall_thickness' });
  } else if (thinRatio > 0.1) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.reinforceThin.action', language), description: translate(CONTENT, 'cad.repair.reinforceThin.desc', language, { pct: (thinRatio * 100).toFixed(0) }), impact: 'medium', category: 'wall_thickness' });
  }

  if (!t?.isManifold) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.repairNonManifold.action', language), description: translate(CONTENT, 'cad.repair.repairNonManifold.desc', language), impact: 'high', category: 'geometry' });
  }

  if (v != null && !v.isWatertight && v.holeCount > 0) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.closeHoles.action', language), description: translate(CONTENT, 'cad.repair.closeHoles.desc', language, { count: v.holeCount }), impact: 'high', category: 'geometry' });
  }

  if (bf != null && !bf.fits) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.fitBed.action', language), description: translate(CONTENT, 'cad.repair.fitBed.desc', language, { name: bf.printerProfile.name, w: bf.printerProfile.widthMm, d: bf.printerProfile.depthMm, h: bf.printerProfile.heightMm }), impact: 'medium', category: 'scale' });
  }

  const diff = sp?.difficulty as SupportDifficulty | undefined;
  if (diff === 'very_difficult' || diff === 'difficult') {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.reduceSupport.action', language), description: translate(CONTENT, 'cad.repair.reduceSupport.desc', language), impact: 'medium', category: 'support' });
  }

  if (sp != null && sp.largestRegionRatio > 0.5) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.optimizeOrientation.action', language), description: translate(CONTENT, 'cad.repair.optimizeOrientation.desc', language), impact: 'medium', category: 'orientation' });
  }

  if (t != null && t.shellCount > 1) {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.mergeComponents.action', language), description: translate(CONTENT, 'cad.repair.mergeComponents.desc', language, { count: t.shellCount }), impact: 'low', category: 'geometry' });
  }

  if (sev === 'moderate') {
    suggestions.push({ action: translate(CONTENT, 'cad.repair.gradualOverhang.action', language), description: translate(CONTENT, 'cad.repair.gradualOverhang.desc', language), impact: 'low', category: 'overhang' });
  }

  return suggestions;
}

export function buildIssuesFromSuggestions(_suggestions: RepairSuggestion[], analysis: UnifiedAnalysis, language: ContentLang = 'en'): Issue[] {
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;
  const v = analysis.validation?.result;
  const sp = analysis.support?.result;
  const issues: Issue[] = [];

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  if (sev === 'severe') issues.push({ severity: 'error', message: translate(CONTENT, 'cad.issue.severeOverhang', language) });
  else if (sev === 'moderate') issues.push({ severity: 'warning', message: translate(CONTENT, 'cad.issue.moderateOverhang', language), suggestion: translate(CONTENT, 'cad.issue.paintSupports', language) });

  if (!t?.isManifold) issues.push({ severity: 'error', message: translate(CONTENT, 'cad.issue.nonManifold', language), suggestion: translate(CONTENT, 'cad.issue.runRepair', language) });

  if (v != null && !v.isWatertight) issues.push({ severity: 'error', message: translate(CONTENT, 'cad.issue.notWatertight', language), suggestion: translate(CONTENT, 'cad.issue.closeHoles', language) });

  const thinRatio = m?.thinWallRatio ?? 0;
  if (thinRatio > 0.3) issues.push({ severity: 'error', message: translate(CONTENT, 'cad.issue.thinWalls', language, { pct: (thinRatio * 100).toFixed(0) }), suggestion: translate(CONTENT, 'cad.issue.thickenTo12', language) });
  else if (thinRatio > 0.1) issues.push({ severity: 'warning', message: translate(CONTENT, 'cad.issue.someThinWalls', language, { pct: (thinRatio * 100).toFixed(0) }), suggestion: translate(CONTENT, 'cad.issue.reinforce', language) });

  const diff = sp?.difficulty as SupportDifficulty | undefined;
  if (diff === 'very_difficult') issues.push({ severity: 'warning', message: translate(CONTENT, 'cad.issue.difficultSupport', language), suggestion: translate(CONTENT, 'cad.issue.splitModel', language) });
  else if (diff === 'difficult') issues.push({ severity: 'info', message: translate(CONTENT, 'cad.issue.complexSupport', language), suggestion: translate(CONTENT, 'cad.issue.considerOrientation', language) });

  return issues;
}
