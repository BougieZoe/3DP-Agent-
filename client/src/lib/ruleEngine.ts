/**
 * Rule Engine — Free tier analysis, no API needed
 * Handles common 3D printing questions with deterministic answers
 */

import { CONTENT, translate } from '@shared/i18n/content';
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
function formatMinThickness(v: number | null, lang: 'en' | 'ja' | 'zh'): string {
  if (v === null) return translate(CONTENT, 'notMeasured', lang);
  return `${v.toFixed(2)}mm`;
}

// Quick local analysis report — no API
export function generateQuickReport(
  model: ModelData,
  lang: 'en' | 'ja' | 'zh',
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
  const process = volume > reportConfig.processLargeVolumeMm3
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
  lang: 'en' | 'ja' | 'zh',
  material: Material = DEFAULT_MATERIAL,
  thresholds: AnalysisThresholds = getThresholds(),
): string {
  const reportConfig = thresholds.report;
  const isZh = lang === 'zh', isJa = lang === 'ja';

  switch (category) {
    case 'printability': {
      const ok = model.wallThickness.status !== 'critical' && model.overhang.status !== 'critical';
      return ok
        ? (isZh ? '✓ 该模型可以打印。壁厚和悬垂角度在合理范围内。' : isJa ? '✓ このモデルは印刷可能です。' : '✓ This model is printable. Wall thickness and overhangs are within acceptable range.')
        : (isZh ? '⚠ 存在打印风险，建议修复壁厚或悬垂问题后再打印。' : isJa ? '⚠ 印刷リスクあり。修正を推奨します。' : '⚠ Print risk detected. Fix wall thickness or overhang issues first.');
    }
    case 'material': {
      const v = model.volume;
      if (v > reportConfig.processLargeVolumeMm3) return isZh ? '推荐 FDM — 适合大型零件，成本低，速度快。材料建议：PLA / PETG / ABS。' : isJa ? 'FDM推奨 — 大型部品に最適。材料: PLA / PETG / ABS' : 'Recommend FDM — best for large parts. Materials: PLA / PETG / ABS.';
      if (v > reportConfig.processMidVolumeMm3) return isZh ? '推荐 FDM 或 SLA，取决于精度需求。精度要求高选SLA，成本优先选FDM。' : isJa ? 'FDMまたはSLAを推奨。精度重視ならSLA。' : 'FDM or SLA depending on precision needs. High detail → SLA. Cost-first → FDM.';
      return isZh ? '推荐 SLA / SLS — 适合小型精细件，表面光洁度高。' : isJa ? 'SLA / SLS推奨 — 小型精細部品に最適。' : 'Recommend SLA / SLS — ideal for small detailed parts with fine surface finish.';
    }
    case 'support': {
      const needs = model.overhang.status !== 'good';
      return needs
        ? (isZh ? `需要支撑。检测到 ${model.overhang.areas} 个面超过${material.overhangThreshold}°悬垂角。建议在切片软件中开启自动支撑。` : isJa ? `サポート必要。${model.overhang.areas}面が${material.overhangThreshold}°超。スライサーで自動サポートを有効に。` : `Support required. ${model.overhang.areas} faces exceed ${material.overhangThreshold}°. Enable auto-support in your slicer.`)
        : (isZh ? `无需支撑。所有悬垂角度在${material.overhangThreshold}°以内，可直接打印。` : isJa ? `サポート不要。全面が${material.overhangThreshold}°以内です。` : `No support needed. All overhangs within ${material.overhangThreshold}° limit.`);
    }
    case 'settings':
      return isZh ? '推荐设置：层高 0.2mm，填充率 20%（结构件提高至40%+），打印速度 50mm/s，壁厚 3层。' :
        isJa ? '推奨設定: 積層0.2mm、充填20%（構造部品は40%+）、速度50mm/s、壁3層。' :
        'Recommended: Layer 0.2mm, Infill 20% (40%+ for structural), Speed 50mm/s, Walls 3 perimeters.';
    case 'time': {
      const vol = model.volume / 1000;
      const mins = Math.round(vol * 0.8 + 20);
      return isZh ? `预计打印时间：${mins}–${mins + 30} 分钟（基于体积估算，FDM 0.2mm层高）。实际时间取决于切片设置。` :
        isJa ? `推定印刷時間: ${mins}〜${mins + 30}分（体積推定、FDM 0.2mm）。実際はスライサー設定による。` :
        `Estimated print time: ${mins}–${mins + 30} min (volume-based, FDM 0.2mm). Actual time depends on slicer settings.`;
    }
    case 'cost': {
      const grams = model.volume * (material.densityGPerCm3 / 1000);
      const cost = (grams * material.pricePerKgUsd / 1000).toFixed(2);
      return isZh ? `材料成本估算：约 ¥${(parseFloat(cost) * 7).toFixed(1)}（${material.name}，基于体积）。不含机器、人工、后处理费用。` :
        isJa ? `材料コスト概算: 約￥${(parseFloat(cost) * 150).toFixed(0)}（${material.name}、体積ベース）。機械・人件費は含まず。` :
        `Material cost estimate: ~$${cost} (${material.name}, volume-based). Excludes machine time, labor, post-processing.`;
    }
    case 'geometry':
      return isZh ? `模型尺寸：${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm。最小壁厚：${formatMinThickness(model.wallThickness.minThickness, lang)}。悬垂面：${model.overhang.areas} 个。` :
        isJa ? `寸法: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm。最小壁厚: ${formatMinThickness(model.wallThickness.minThickness, lang)}。オーバーハング: ${model.overhang.areas}面。` :
        `Dims: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm. Min wall: ${formatMinThickness(model.wallThickness.minThickness, lang)}. Overhangs: ${model.overhang.areas} faces.`;
    default:
      return '';
  }
}
