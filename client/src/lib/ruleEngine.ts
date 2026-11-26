/**
 * Rule Engine — Free tier analysis, no API needed
 * Handles common 3D printing questions with deterministic answers
 */

import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { Material } from '@shared/domain/material';
import { DEFAULT_MATERIAL } from '@shared/domain/material';
import { getThresholds, type AnalysisThresholds } from '@/analysis/thresholds';

export interface ModelData {
  fileName: string;
  wallThickness: {
    /** null when the raycast could not produce a measurement — never a bbox estimate. */
    minThickness: number | null;
    p1Thickness: number | null;
    p5Thickness: number | null;
    p10Thickness: number | null;
    medianThickness: number | null;
    avgThickness: number | null;
    thinWallCount: number;
    thinWallPercentage: number;
    thinWallRatio: number;
    averageConfidence: number;
    areas: number;
    status: 'good' | 'warning' | 'critical';
  };
  overhang: { angle: number; areas: number; status: 'good' | 'warning' | 'critical' };
  volume: number;
  /** False when the shell is open — `volume` is then a by-product, not a measurement. */
  volumeReliable: boolean;
  surfaceArea: number;
  dims: { x: number; y: number; z: number };
}

export interface RuleResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  needsAI: boolean;
  category: string;
}

// Format a wall-thickness value for display; an unmeasured (null) value is
// reported honestly instead of substituting a fabricated number.
function formatMinThickness(v: number | null, lang: ContentLang): string {
  if (v === null) return translate(CONTENT, 'notMeasured', lang);
  return `${v.toFixed(2)}mm`;
}

// Quick local analysis report — no API
export function generateQuickReport(
  model: ModelData,
  lang: ContentLang,
  material: Material = DEFAULT_MATERIAL,
  thresholds: AnalysisThresholds = getThresholds(),
): string {
  const reportConfig = thresholds.report;
  const issues: string[] = [];
  const tips: string[] = [];

  const twr = model.wallThickness.thinWallPercentage != null
    ? model.wallThickness.thinWallPercentage / 100
    : model.wallThickness.thinWallPercentage;
  const pct = ((twr ?? 0) * 100).toFixed(1);
  const conf = model.wallThickness.averageConfidence;
  const confLabel = conf < reportConfig.confidenceLowBelow
    ? translate(CONTENT, 'report.confidence.low', lang)
    : conf < reportConfig.confidenceModerateBelow
      ? translate(CONTENT, 'report.confidence.moderate', lang)
      : translate(CONTENT, 'report.confidence.high', lang);

  if (model.wallThickness.status === 'critical') {
    if ((twr ?? 0) > reportConfig.wallCriticalThinRatio) {
      issues.push(translate(CONTENT, 'rule.wallCritical', lang, { pct, t: formatMinThickness(model.wallThickness.minThickness, lang), conf: confLabel }));
    } else {
      issues.push(translate(CONTENT, 'rule.wallCriticalIsolated', lang, { pct, t: formatMinThickness(model.wallThickness.minThickness, lang), conf: confLabel }));
    }
  } else if (model.wallThickness.status === 'warning') {
    issues.push(translate(CONTENT, 'rule.wallWarning', lang, { pct, t: formatMinThickness(model.wallThickness.minThickness, lang) }));
  }

  if (model.overhang.status === 'warning' || model.overhang.status === 'critical') {
    issues.push(translate(CONTENT, 'rule.overhang', lang, { areas: model.overhang.areas, threshold: material.overhangThreshold }));
  }

  const maxDim = Math.max(model.dims.x, model.dims.y, model.dims.z);
  if (maxDim < reportConfig.sizeUnusualMinMm || maxDim > reportConfig.sizeUnusualMaxMm) {
    issues.push(translate(CONTENT, 'rule.sizeUnusual', lang, { max: maxDim.toFixed(1) }));
  }

  const volume = model.volume;
  const process = model.volumeReliable === false
    ? translate(CONTENT, 'rule.processUnknown', lang)
    : volume > reportConfig.processLargeVolumeMm3
      ? translate(CONTENT, 'rule.processLarge', lang)
      : volume > reportConfig.processMidVolumeMm3
        ? translate(CONTENT, 'rule.processMid', lang)
        : translate(CONTENT, 'rule.processSmall', lang);

  const verdict = issues.length === 0
    ? translate(CONTENT, 'rule.verdictOk', lang)
    : translate(CONTENT, 'rule.verdictFix', lang);

  const lines = [
    translate(CONTENT, 'report.verdict', lang, { verdict }),
    ``,
    translate(CONTENT, 'rule.dims', lang, { x: model.dims.x.toFixed(1), y: model.dims.y.toFixed(1), z: model.dims.z.toFixed(1) }),
    translate(CONTENT, 'rule.processLabel', lang, { process }),
    translate(CONTENT, 'rule.layer', lang),
  ];

  if (issues.length > 0) {
    lines.push('');
    lines.push(translate(CONTENT, 'report.issues', lang));
    issues.forEach((i, idx) => lines.push(`${idx + 1}. ${i}`));
  }
  if (tips.length > 0) {
    lines.push('');
    lines.push(translate(CONTENT, 'report.tips', lang));
    tips.forEach(t => lines.push(`› ${t}`));
  }

  return lines.join('\n');
}

// Classify if a question needs AI or can be answered locally
export function classifyQuestion(question: string): { needsAI: boolean; category: string } {
  const q = question.toLowerCase();

  const simplePatterns = [
    { pattern: /can.*(print|打印|印刷)/, category: 'printability' },
    { pattern: /(material|材料|素材)/, category: 'material' },
    { pattern: /(support|支撑|サポート)/, category: 'support' },
    { pattern: /(layer|层高|積層)/, category: 'settings' },
    { pattern: /(infill|填充|充填)/, category: 'settings' },
    { pattern: /(time|时间|時間|how long)/, category: 'time' },
    { pattern: /(cost|费用|コスト|price|价格)/, category: 'cost' },
    { pattern: /(size|尺寸|サイズ|dimension)/, category: 'geometry' },
    { pattern: /(wall|壁厚|壁厚さ)/, category: 'geometry' },
    { pattern: /(overhang|悬垂|オーバーハング)/, category: 'geometry' },
  ];

  for (const { pattern, category } of simplePatterns) {
    if (pattern.test(q)) return { needsAI: false, category };
  }

  // Complex questions → AI
  return { needsAI: true, category: 'complex' };
}

// Local answers for common questions
export function answerLocally(
  category: string,
  model: ModelData,
  lang: ContentLang,
  material: Material = DEFAULT_MATERIAL,
  thresholds: AnalysisThresholds = getThresholds(),
): string {
  const reportConfig = thresholds.report;

  switch (category) {
    case 'printability': {
      const ok = model.wallThickness.status !== 'critical' && model.overhang.status !== 'critical';
      return translate(CONTENT, ok ? 'rule.summary.printable' : 'rule.summary.printRisk', lang);
    }
    case 'material': {
      if (model.volumeReliable === false) return translate(CONTENT, 'rule.volumeUnmeasurable', lang);
      const v = model.volume;
      if (v > reportConfig.processLargeVolumeMm3) return translate(CONTENT, 'rule.rec.large', lang);
      if (v > reportConfig.processMidVolumeMm3) return translate(CONTENT, 'rule.rec.mid', lang);
      return translate(CONTENT, 'rule.rec.small', lang);
    }
    case 'support': {
      if (model.overhang.status !== 'good') {
        return translate(CONTENT, 'rule.support.needed', lang, {
          areas: model.overhang.areas,
          deg: material.overhangThreshold,
        });
      }
      return translate(CONTENT, 'rule.support.none', lang, { deg: material.overhangThreshold });
    }
    case 'settings':
      return translate(CONTENT, 'rule.settings.default', lang);
    case 'time': {
      if (model.volumeReliable === false) return translate(CONTENT, 'rule.volumeUnmeasurable', lang);
      const mins = Math.round((model.volume / 1000) * 0.8 + 20);
      return translate(CONTENT, 'rule.time.estimate', lang, { min: mins, max: mins + 30 });
    }
    case 'cost': {
      if (model.volumeReliable === false) return translate(CONTENT, 'rule.volumeUnmeasurable', lang);
      const grams = model.volume * (material.densityGPerCm3 / 1000);
      const usd = (grams * material.pricePerKgUsd / 1000).toFixed(2);
      const amount = lang === 'zh'
        ? `¥${(parseFloat(usd) * 7).toFixed(1)}`
        : lang === 'ja'
          ? `￥${(parseFloat(usd) * 150).toFixed(0)}`
          : `$${usd}`;
      return translate(CONTENT, 'rule.cost.estimate', lang, { amount, material: material.name });
    }
    case 'geometry': {
      return translate(CONTENT, 'rule.geometry.summary', lang, {
        x: model.dims.x.toFixed(1),
        y: model.dims.y.toFixed(1),
        z: model.dims.z.toFixed(1),
        minWall: formatMinThickness(model.wallThickness.minThickness, lang),
        areas: model.overhang.areas,
      });
    }
    default:
      return '';
  }
}
