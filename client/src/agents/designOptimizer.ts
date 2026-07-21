import type { UnifiedAnalysis, OverhangSeverity, SupportDifficulty } from '@/analysis';
import type { CADConfidenceReport, DesignIntent, RepairSuggestion } from '@/cad-confidence';

export interface OptimizationDecision {
  action: 'wall_thickening' | 'orientation_change' | 'none';
  reason: string;
  expectedImprovement: number;
  detected: string;
  engineeringReason: string;
  expectedImpact: string;
}

interface Candidate {
  action: OptimizationDecision['action'];
  reason: string;
  expectedImprovement: number;
  detected: string;
  engineeringReason: string;
  expectedImpact: string;
  score: number;
}

export function optimizeDesign(
  analysis: UnifiedAnalysis,
  _confidenceReport: CADConfidenceReport,
  _repairSuggestions: RepairSuggestion[],
  _designIntent: DesignIntent,
): OptimizationDecision {
  const m = analysis.metrics?.result;
  const sp = analysis.support?.result;
  const sev = m?.overhang?.severity as OverhangSeverity | undefined;
  const diff = sp?.difficulty as SupportDifficulty | undefined;
  const thinRatio = m?.thinWallRatio ?? 0;
  const supportVol = sp?.totalSupportVolumeMm3 ?? 0;
  const overhangFaceCount = m?.overhang?.faceCount ?? 0;
  const wallP5 = m?.p5WallThicknessMm;

  const candidates: Candidate[] = [];

  // ── wall_thickening candidate ──
  if (thinRatio > 0.05) {
    const pct = (thinRatio * 100).toFixed(0);
    const detected = thinRatio > 0.3
      ? `Extensive thin walls (${pct}% of surface, p5=${wallP5?.toFixed(2) ?? '?'}mm)`
      : `Thin walls detected (${pct}% of surface)`;

    const improvement = Math.round(Math.min(100, thinRatio * 150));
    const score = thinRatio * 100;

    const engineeringReason = thinRatio > 0.3
      ? `${pct}% of surface below 0.8mm minimum wall thickness. p5 thickness at ${wallP5?.toFixed(2) ?? '?'}mm indicates widespread under-dimensioned regions vulnerable to print failure and mechanical weakness.`
      : `${pct}% of sampled regions below recommended 0.8mm wall thickness. Localized reinforcement will improve structural integrity.`;

    const expectedImpact = wallP5 != null
      ? `Thin-wall ratio ${pct}% → <5%. p5 wall thickness ${wallP5.toFixed(2)}mm → ~1.0mm. Failure probability reduced proportionally.`
      : `Thin-wall ratio ${pct}% → <10%. Structural confidence category score target: +20 points.`;

    candidates.push({
      action: 'wall_thickening',
      reason: `Strengthen ${pct}% thin-wall regions to ≥1.2mm`,
      expectedImprovement: improvement,
      detected,
      engineeringReason,
      expectedImpact,
      score,
    });
  }

  // ── orientation_change candidate ──
  if (sev === 'severe' || sev === 'moderate' || diff === 'difficult' || diff === 'very_difficult') {
    const parts: string[] = [];
    if (sev === 'severe') parts.push('Severe overhang');
    else if (sev === 'moderate') parts.push('Moderate overhang');
    if (diff === 'very_difficult') parts.push('Very difficult support');
    else if (diff === 'difficult') parts.push('Complex support');

    const detected = parts.join(' + ');

    const overhangScore = sev === 'severe' ? 70 : sev === 'moderate' ? 35 : 0;
    const supportScore = diff === 'very_difficult' ? 80 : diff === 'difficult' ? 60 : diff === 'moderate' ? 30 : 0;
    const volFactor = Math.min(100, Math.round(supportVol / 1000));

    const improvement = Math.round(Math.min(100, (overhangScore + supportScore + volFactor) / 3));
    const score = overhangScore + supportScore * 0.5 + volFactor * 0.3;

    const engParts: string[] = [];
    if (sev === 'severe') engParts.push(`${overhangFaceCount} overhang faces at >45°`);
    if (diff != null && diff !== 'none') engParts.push(`support difficulty: ${diff}`);
    if (supportVol > 1000) engParts.push(`${Math.round(supportVol)}mm³ support volume`);

    const engineeringReason = engParts.length > 0
      ? `Orienting the model to minimise overhang area reduces or eliminates support requirements. ${engParts.join('; ')} — rotating largest face to the build plate aligns overhang normals within self-supporting range.`
      : `Optimising build orientation to reduce total overhang area and improve surface quality on critical faces.`;

    const expectedImpact = supportVol > 5000
      ? `Support volume ${Math.round(supportVol)}mm³ → <1000mm³. Support difficulty improved by at least 1 level. Print time reduced, post-processing simplified.`
      : `Overhang ratio and support volume reduced. Printability category target: +10–20 points. Surface quality improved on down-facing surfaces.`;

    candidates.push({
      action: 'orientation_change',
      reason: supportVol > 5000
        ? `Reduce support complexity (${Math.round(supportVol)}mm³ support volume)`
        : 'Minimize overhang area by reorienting largest faces to the build plate',
      expectedImprovement: improvement,
      detected,
      engineeringReason,
      expectedImpact,
      score,
    });
  }

  // ── Pick best ──
  if (candidates.length === 0) {
    return {
      action: 'none',
      reason: 'No critical issues detected — design is already optimized',
      expectedImprovement: 0,
      detected: 'No improvement opportunity found',
      engineeringReason: 'All key metrics (overhang, wall thickness, support complexity) are within acceptable tolerances.',
      expectedImpact: 'No change expected — current design meets manufacturing thresholds.',
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    action: candidates[0].action,
    reason: candidates[0].reason,
    expectedImprovement: candidates[0].expectedImprovement,
    detected: candidates[0].detected,
    engineeringReason: candidates[0].engineeringReason,
    expectedImpact: candidates[0].expectedImpact,
  };
}
