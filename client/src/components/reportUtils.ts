import type { UnifiedAnalysis } from "../analysis/types";
import { getThresholds, type AnalysisThresholds } from "@/analysis/thresholds";
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from "@/analysis/metrics";
import type { ToneMode, Language, TrafficLight, ChatMessage } from "./reportTypes";
import { CONTENT, translate } from "@shared/i18n/content";

// ─── Language Detection ─────────────────────────────────────────────────────────

export function detectLanguage(messages: ChatMessage[]): Language {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return japanesePattern.test(userText) ? "ja" : "en";
}

// ─── Tone Detection ────────────────────────────────────────────────────────────

export function detectTone(messages: ChatMessage[]): ToneMode {
  if (!messages.length) return "professional";
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  const expertTerms = [
    "topology", "manifold", "watertight", "overhang angle", "infill",
    "layer height", "retraction", "wall thickness", "stl", "mesh",
    "non-manifold", "boolean", "extrusion multiplier",
    "トポロジー", "マニフォールド", "オーバーハング", "インフィル",
  ];
  const expertScore = expertTerms.filter((t) => userText.includes(t)).length;
  const casualPatterns = [
    /\blol\b/, /\bomg\b/, /gonna/, /wanna/, /u r/, /thx/,
    /haha/, /ugh/, /basically/, /kinda/, /ya know/,
    /なんか/, /てか/, /じゃん/, /だよね/, /感じ/,
  ];
  const casualScore = casualPatterns.filter((p) => p.test(userText)).length;
  const avgWordLength =
    userText.split(/\s+/).reduce((sum, w) => sum + w.length, 0) /
    Math.max(userText.split(/\s+/).length, 1);
  if (expertScore >= 2 || avgWordLength > 8) return "expert";
  if (casualScore >= 2 || avgWordLength < 4) return "friendly";
  return "professional";
}

// ─── Traffic Light Score ───────────────────────────────────────────────────────

/**
 * A single deduction from the go/no-go gate. `rule` is a stable id the UI
 * translates; `penalty` is what it took off the score; `value` is the measured
 * quantity behind it (boundary edges, area ratio, mm…) so the UI can say
 * "why" instead of only "how much".
 */
export type GateDeduction = {
  rule:
    | 'shell'
    | 'holes'
    | 'normals'
    | 'degenerate'
    | 'thinWall'
    | 'lowConfidence'
    | 'overhang'
    | 'support';
  penalty: number;
  value?: number;
  severity?: 'critical' | 'warning';
};

export function getTrafficLight(
  analysis: UnifiedAnalysis,
  thresholds: AnalysisThresholds = getThresholds(),
): {
  light: TrafficLight;
  score: number;
  /**
   * Every deduction that produced the score, in evaluation order.
   *
   * The UI no longer shows the raw /100 as the headline: a gate is a verdict,
   * not a quality rating, and "0/100" next to an otherwise printable part read
   * as "worthless". Callers render the verdict word plus these reasons, and keep
   * the number in the methodology detail.
   */
  deductions: GateDeduction[];
} {
  let score = 100;
  const gate = thresholds.gate;
  const deductions: GateDeduction[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;

  const deduct = (d: GateDeduction) => {
    deductions.push(d);
    score -= d.penalty;
  };

  if (v) {
    if (!v.isWatertight) deduct({ rule: 'shell', penalty: gate.shellPenalty, value: v.boundaryEdgeCount });
    if (v.holeCount > 0) deduct({ rule: 'holes', penalty: v.holeCount * gate.holesPenaltyPerHole, value: v.holeCount });
    if (v.flippedNormalRatio > gate.flippedNormalRatioMax) deduct({ rule: 'normals', penalty: gate.flippedNormalPenalty, value: v.flippedNormalRatio });
    if (v.degenerateFaceCount > gate.degenerateFaceCountMax) deduct({ rule: 'degenerate', penalty: gate.degeneratePenalty, value: v.degenerateFaceCount });
  }

  if (m) {
    const wtStatus = deriveWtStatus(m.thinWallRatio ?? 0, m.p5WallThicknessMm);
    if (wtStatus === 'critical') deduct({ rule: 'thinWall', penalty: gate.thinWallCriticalPenalty, severity: 'critical', value: m.p5WallThicknessMm ?? undefined });
    else if (wtStatus === 'warning') deduct({ rule: 'thinWall', penalty: gate.thinWallWarningPenalty, severity: 'warning', value: m.p5WallThicknessMm ?? undefined });
    if ((m.averageConfidence ?? 0) < gate.lowConfidenceMax && (m.thinWallRatio ?? 0) < gate.lowConfidenceThinRatioMax) {
      deduct({ rule: 'lowConfidence', penalty: gate.lowConfidencePenalty, value: m.averageConfidence });
    }
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') deduct({ rule: 'overhang', penalty: gate.overhangCriticalPenalty, severity: 'critical', value: m.overhang.ratio });
    else if (ohStatus === 'warning') deduct({ rule: 'overhang', penalty: gate.overhangWarningPenalty, severity: 'warning', value: m.overhang.ratio });
  }

  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') deduct({ rule: 'support', penalty: gate.supportCriticalPenalty, severity: 'critical' });
    else if (supportStatus.status === 'warning') deduct({ rule: 'support', penalty: gate.supportWarningPenalty, severity: 'warning' });
  }

  score = Math.max(0, Math.min(100, score));

  const light: TrafficLight =
    score >= gate.passScoreMin ? "green" : score >= gate.reviewScoreMin ? "yellow" : "red";

  return { light, score, deductions };
}

// ─── Weight / Time ranges ──────────────────────────────────────────────────────

// Canonical estimate math — single writer. The i18n variants in
// ReportGenerator add the translated note on top of these parts.
export function weightRangeGrams(grams: number): [string, string] {
  return [(grams * 0.05 * 1.2).toFixed(0), (grams * 1.0 * 1.2).toFixed(0)];
}

export function timeRangeMinutes(minutes: number): [number, number] {
  return [Math.round(minutes * 0.7), Math.round(minutes * 1.3)];
}

export function computeWeightRange(grams: number): string {
  const [lo, hi] = weightRangeGrams(grams);
  return `${lo}–${hi}g (varies by infill)`;
}

export function computeTimeRange(minutes: number): string {
  const [lo, hi] = timeRangeMinutes(minutes);
  const f = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${f(lo)} – ${f(hi)} (excl. supports)`;
}

// ─── Issue Builders ────────────────────────────────────────────────────────────

export function buildClientIssues(analysis: UnifiedAnalysis, lang: Language): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(CONTENT, key, lang, params);

  if (m) {
    const twr = m.thinWallRatio ?? 0;
    const p5 = m.p5WallThicknessMm;
    const wtStatus = deriveWtStatus(twr, p5);
    const pct = (twr * 100).toFixed(0);
    if (wtStatus === 'critical') {
      issues.push(t('issue.client.wtCritical', { pct }));
    } else if (wtStatus === 'warning') {
      issues.push(t('issue.client.wtWarning', { pct }));
    } else if ((m.averageConfidence ?? 0) < 0.5) {
      const prefix = m.minWallThicknessMm != null
        ? t('issue.client.minWallPrefix', { mm: m.minWallThicknessMm.toFixed(2) })
        : '';
      issues.push(t('issue.client.wtLowConf', { prefix }));
    }
  }

  if (v && !v.isWatertight) {
    issues.push(t('issue.client.meshOpen'));
    if (v.holeCount > 0) {
      issues.push(t('issue.client.holes', { count: v.holeCount }));
    }
  } else if (v && v.holeCount > 0) {
    issues.push(t('issue.client.holes', { count: v.holeCount }));
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(t('issue.client.flipped'));
  }

  if (m) {
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') {
      issues.push(t('issue.client.ohCritical'));
    } else if (ohStatus === 'warning') {
      issues.push(t('issue.client.ohWarning'));
    }
  }

  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') {
      issues.push(t('issue.client.supportComplex'));
    } else if (supportStatus.status === 'warning' && supportStatus.reasons.length > 0) {
      issues.push(t('issue.client.supportCaution', { reason: supportStatus.reasons[0] }));
    }
  }

  return issues;
}

export function buildDesignerIssues(
  analysis: UnifiedAnalysis,
  _tone: ToneMode,
  lang: Language
): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(CONTENT, key, lang, params);

  if (m) {
    const twr = m.thinWallRatio ?? 0;
    const p5 = m.p5WallThicknessMm;
    const p10 = m.p10WallThicknessMm;
    const avg = m.avgWallThicknessMm;
    const conf = m.averageConfidence ?? 0;
    const wtStatus = deriveWtStatus(twr, p5);
    const pct = (twr * 100).toFixed(0);
    if (wtStatus === 'critical') {
      issues.push(t('issue.designer.wtCritical', { pct, p5: (p5 ?? avg ?? 0).toFixed(2) }));
    } else if (wtStatus === 'warning') {
      const display = p10 ?? p5 ?? avg;
      issues.push(t('issue.designer.wtWarning', { pct, p10: (display ?? 0).toFixed(2) }));
    } else if (conf < 0.5) {
      const prefix = m.minWallThicknessMm != null
        ? t('issue.designer.minWallPrefix', { mm: m.minWallThicknessMm.toFixed(2) })
        : '';
      issues.push(t('issue.designer.wtLowConf', { conf: (conf * 100).toFixed(0), prefix }));
    }
  }

  if (v && !v.isWatertight) {
    issues.push(t('issue.designer.meshOpen'));
    if (v.holeCount > 0) {
      issues.push(t('issue.designer.holes', { count: v.holeCount }));
    }
  } else if (v && v.holeCount > 0) {
    issues.push(t('issue.designer.holes', { count: v.holeCount }));
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(t('issue.designer.flipped', { pct: (v.flippedNormalRatio * 100).toFixed(0) }));
  }

  if (m) {
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') {
      issues.push(t('issue.designer.ohSevere'));
    } else if (ohStatus === 'warning') {
      issues.push(t('issue.designer.ohModerate'));
    }
  }

  const sup = analysis.support?.result;
  if (sup) {
    const supportStatus = deriveSupportStatus(sup);
    if (supportStatus.status === 'critical') {
      issues.push(supportStatus.reasons[0] ?? t('issue.designer.supportFallback'));
    } else if (supportStatus.status === 'warning') {
      for (const reason of supportStatus.reasons.slice(0, 2)) {
        issues.push(t('issue.designer.supportItem', { reason }));
      }
    }
  }

  return issues;
}
