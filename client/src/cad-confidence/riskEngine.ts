import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis, OverhangSeverity, SupportDifficulty } from '@/analysis';
import type { RiskAssessment, RiskLevel, IntentMatchResult } from './types';

function toLevel(score: number): RiskLevel {
  if (score <= 30) return 'LOW';
  if (score <= 60) return 'MEDIUM';
  return 'HIGH';
}

export function computeStructuralRisk(analysis: UnifiedAnalysis, language: ContentLang = 'en'): RiskAssessment {
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;
  const v = analysis.validation?.result;
  const reasons: string[] = [];

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  const overhangScore = sev === 'moderate' ? 30 : sev === 'severe' ? 70 : 0;
  if (sev === 'severe') reasons.push(translate(CONTENT, 'cad.risk.severeOverhang', language));
  else if (sev === 'moderate') reasons.push(translate(CONTENT, 'cad.risk.moderateOverhang', language));

  const thinRatio = m?.thinWallRatio ?? 0;
  const wallScore = thinRatio > 0.2 ? 70 : thinRatio > 0.05 ? 30 : 0;
  if (thinRatio > 0.2) reasons.push(translate(CONTENT, 'cad.risk.extensiveThinWalls', language));
  else if (thinRatio > 0.05) reasons.push(translate(CONTENT, 'cad.risk.someThinWalls', language));

  const topoScore = t?.isManifold ? 0 : 40;
  if (!t?.isManifold) reasons.push(translate(CONTENT, 'cad.risk.nonManifold', language));

  const shellScore = t?.shellCount != null && t.shellCount > 1 ? 20 : 0;
  if (t?.shellCount != null && t.shellCount > 1) reasons.push(translate(CONTENT, 'cad.risk.disconnectedShells', language));

  const waterScore = v?.isWatertight ? 0 : 30;
  if (v != null && !v.isWatertight) reasons.push(translate(CONTENT, 'cad.risk.notWatertight', language));

  const score = Math.round(
    overhangScore * 0.30 +
    wallScore * 0.35 +
    topoScore * 0.15 +
    shellScore * 0.10 +
    waterScore * 0.10
  );

  return { score, level: toLevel(score), reasons };
}

export function computePrintRisk(analysis: UnifiedAnalysis, language: ContentLang = 'en'): RiskAssessment {
  const m = analysis.metrics?.result;
  const sp = analysis.support?.result;
  const bf = analysis.bedFit?.result;
  const pt = analysis.printTime?.result;
  const reasons: string[] = [];

  const diff = sp?.difficulty as SupportDifficulty | undefined;
  const supportScore = diff === 'easy' ? 15 : diff === 'moderate' ? 40 : diff === 'difficult' ? 60 : diff === 'very_difficult' ? 80 : 0;
  if (diff === 'very_difficult' || diff === 'difficult') reasons.push(translate(CONTENT, 'cad.risk.complexSupport', language));
  else if (diff === 'moderate') reasons.push(translate(CONTENT, 'cad.risk.moderateSupport', language));

  const bedScore = bf?.fits ? 0 : 70;
  if (bf != null && !bf.fits) reasons.push(translate(CONTENT, 'cad.risk.exceedsBed', language));

  const volScore = m?.meshVolumeMm3 != null && m.meshVolumeMm3 >= 500000 ? 30 : 0;
  if (m?.meshVolumeMm3 != null && m.meshVolumeMm3 >= 500000) reasons.push(translate(CONTENT, 'cad.risk.largeVolume', language));

  const timeScore = pt != null ? (pt.estimatedPrintTimeHours > 12 ? 40 : pt.estimatedPrintTimeHours > 5 ? 20 : 0) : 0;
  if (pt != null && pt.estimatedPrintTimeHours > 12) reasons.push(translate(CONTENT, 'cad.risk.longPrint', language));

  const score = Math.round(
    supportScore * 0.40 +
    bedScore * 0.30 +
    volScore * 0.15 +
    timeScore * 0.15
  );

  return { score, level: toLevel(score), reasons };
}

export function computeManufacturingRisk(
  structural: RiskAssessment,
  print: RiskAssessment,
  intentMatch: IntentMatchResult | undefined,
  language: ContentLang = 'en',
): RiskAssessment {
  const intentScore = intentMatch != null ? 100 - intentMatch.score : 0;
  const reasons: string[] = [...structural.reasons, ...print.reasons];
  if (intentMatch != null && intentMatch.score < 50) reasons.push(translate(CONTENT, 'cad.risk.intentMismatch', language));

  const score = Math.round(
    structural.score * 0.35 +
    print.score * 0.35 +
    intentScore * 0.30
  );

  return { score, level: toLevel(score), reasons };
}

export function aggregateOverallRisk(analysis: UnifiedAnalysis, intentScore: number): number {
  const m = analysis.metrics?.result;
  const t = analysis.topology?.result;

  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  const overhangFactor = sev === 'severe' ? 100 : sev === 'moderate' ? 40 : 0;

  const thinRatio = m?.thinWallRatio ?? 0;
  const thinFactor = thinRatio > 0.2 ? 100 : thinRatio > 0.05 ? 40 : 0;

  const topoFactor = !t?.isManifold ? 100 : (t?.shellCount ?? 0) > 1 ? 30 : 0;

  const intentFactor = 100 - intentScore;

  return Math.round(
    overhangFactor * 0.35 +
    thinFactor * 0.25 +
    topoFactor * 0.20 +
    intentFactor * 0.20
  );
}
