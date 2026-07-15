/**
 * Rule Engine — Free tier analysis, no API needed
 * Handles common 3D printing questions with deterministic answers
 */

import type { Material } from '@/lib/materialState';
import { DEFAULT_MATERIAL } from '@/lib/materialState';

export interface ModelData {
  fileName: string;
  wallThickness: {
    minThickness: number;
    p1Thickness: number | null;
    p5Thickness: number | null;
    p10Thickness: number | null;
    medianThickness: number | null;
    avgThickness: number | null;
    thinWallCount: number;
    thinWallPercentage: number;
    thinWallRatio: number;
    averageConfidence: number;
    lowConfidenceSampleCount: number;
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

// Quick local analysis report — no API
export function generateQuickReport(model: ModelData, lang: 'en' | 'ja' | 'zh', material: Material = DEFAULT_MATERIAL): string {
  const issues: string[] = [];
  const tips: string[] = [];

  const twr = model.wallThickness.thinWallPercentage != null
    ? model.wallThickness.thinWallPercentage / 100
    : model.wallThickness.thinWallPercentage;
  const pct = ((twr ?? 0) * 100).toFixed(1);
  const conf = model.wallThickness.averageConfidence;
  const confLabel = conf < 0.4 ? 'Low' : conf < 0.7 ? 'Moderate' : 'High';

  if (model.wallThickness.status === 'critical') {
    if ((twr ?? 0) > 0.15) {
      issues.push(lang === 'zh' ? `壁厚过薄: ${pct}% 采样区域低于FDM阈值。最小测量值: ${model.wallThickness.minThickness.toFixed(2)}mm。置信度: ${confLabel}` :
        lang === 'ja' ? `壁厚過小: サンプルの${pct}%がFDM閾値未満。最小測定: ${model.wallThickness.minThickness.toFixed(2)}mm。信頼度: ${confLabel}` :
        `Widespread thin walls: ${pct}% of sampled regions below FDM threshold. Minimum measured: ${model.wallThickness.minThickness.toFixed(2)}mm. Confidence: ${confLabel}`);
    } else {
      issues.push(lang === 'zh' ? `检测到孤立薄壁异常。最小测量值: ${model.wallThickness.minThickness.toFixed(2)}mm，但仅${pct}%采样区域低于阈值。置信度: ${confLabel}` :
        lang === 'ja' ? `孤立した薄壁異常を検出。最小測定: ${model.wallThickness.minThickness.toFixed(2)}mm、ただしサンプルの${pct}%のみが閾値未満。信頼度: ${confLabel}` :
        `Isolated thin wall anomaly. Minimum measured: ${model.wallThickness.minThickness.toFixed(2)}mm, but only ${pct}% of sampled regions below threshold. Confidence: ${confLabel}`);
    }
  } else if (model.wallThickness.status === 'warning') {
    issues.push(lang === 'zh' ? `${pct}% 采样区域壁厚偏薄 (p5=${model.wallThickness.minThickness.toFixed(2)}mm)。建议加厚至2mm以上` :
      lang === 'ja' ? `サンプルの${pct}%が薄い壁 (p5=${model.wallThickness.minThickness.toFixed(2)}mm)。2mm以上を推奨` :
      `${pct}% of sampled walls are thin (p5=${model.wallThickness.minThickness.toFixed(2)}mm). Consider thickening to 2mm+`);
  }

  if (model.overhang.status === 'warning' || model.overhang.status === 'critical') {
    issues.push(lang === 'zh' ? `${model.overhang.areas} 个悬垂面超过${material.overhangThreshold}°，需要支撑` :
      lang === 'ja' ? `${model.overhang.areas}面が${material.overhangThreshold}°超 — サポート必要` :
      `${model.overhang.areas} faces exceed ${material.overhangThreshold}° — support structures required`);
  }

  const maxDim = Math.max(model.dims.x, model.dims.y, model.dims.z);
  if (maxDim < 1 || maxDim > 1000) {
    issues.push(lang === 'zh' ? `尺寸看起来不寻常 (最长边=${maxDim.toFixed(1)}mm) —— 这个模型是用英寸建模的吗？` :
      lang === 'ja' ? `サイズが不自然です (最大辺=${maxDim.toFixed(1)}mm) —— インチでモデリングされていませんか？` :
      `This size looks unusual for millimeters (longest side=${maxDim.toFixed(1)}mm) — was this modeled in inches?`);
  }

  const volume = model.volume;
  const process = volume > 500000 ? (lang === 'zh' ? 'FDM (大型件)' : lang === 'ja' ? 'FDM（大型）' : 'FDM (large part)') :
    volume > 50000 ? (lang === 'zh' ? 'FDM / SLA' : 'FDM / SLA') :
    (lang === 'zh' ? 'SLA / SLS (精细件)' : lang === 'ja' ? 'SLA / SLS（精細）' : 'SLA / SLS (fine detail)');

  const verdict = issues.length === 0
    ? (lang === 'zh' ? '✓ 可直接打印' : lang === 'ja' ? '✓ 印刷可能' : '✓ Print-ready')
    : (lang === 'zh' ? '⚠ 需要修复后打印' : lang === 'ja' ? '⚠ 修正が必要' : '⚠ Needs fixes before printing');

  const lines = [
    `VERDICT: ${verdict}`,
    ``,
    lang === 'zh' ? `尺寸: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm` :
    lang === 'ja' ? `寸法: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm` :
    `Dims: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm`,
    lang === 'zh' ? `推荐工艺: ${process}` : lang === 'ja' ? `推奨工法: ${process}` : `Recommended: ${process}`,
    lang === 'zh' ? `层高建议: 0.2mm  填充率: 20%` : lang === 'ja' ? `積層ピッチ: 0.2mm  充填率: 20%` : `Layer: 0.2mm  Infill: 20%`,
  ];

  if (issues.length > 0) {
    lines.push('');
    lines.push(lang === 'zh' ? 'ISSUES:' : lang === 'ja' ? '問題点:' : 'ISSUES:');
    issues.forEach((i, idx) => lines.push(`${idx + 1}. ${i}`));
  }
  if (tips.length > 0) {
    lines.push('');
    lines.push(lang === 'zh' ? 'TIPS:' : 'TIPS:');
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
export function answerLocally(category: string, model: ModelData, lang: 'en' | 'ja' | 'zh', material: Material = DEFAULT_MATERIAL): string {
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
      if (v > 500000) return isZh ? '推荐 FDM — 适合大型零件，成本低，速度快。材料建议：PLA / PETG / ABS。' : isJa ? 'FDM推奨 — 大型部品に最適。材料: PLA / PETG / ABS' : 'Recommend FDM — best for large parts. Materials: PLA / PETG / ABS.';
      if (v > 50000) return isZh ? '推荐 FDM 或 SLA，取决于精度需求。精度要求高选SLA，成本优先选FDM。' : isJa ? 'FDMまたはSLAを推奨。精度重視ならSLA。' : 'FDM or SLA depending on precision needs. High detail → SLA. Cost-first → FDM.';
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
      return isZh ? `模型尺寸：${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm。最小壁厚：${model.wallThickness.minThickness.toFixed(2)}mm。悬垂面：${model.overhang.areas} 个。` :
        isJa ? `寸法: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm。最小壁厚: ${model.wallThickness.minThickness.toFixed(2)}mm。オーバーハング: ${model.overhang.areas}面。` :
        `Dims: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm. Min wall: ${model.wallThickness.minThickness.toFixed(2)}mm. Overhangs: ${model.overhang.areas} faces.`;
    default:
      return '';
  }
}
