/**
 * Rule Engine — Free tier analysis, no API needed
 * Handles common 3D printing questions with deterministic answers
 */

export interface ModelData {
  fileName: string;
  wallThickness: {
    minThickness: number;
    averageThickness?: number;
    areas: number;
    sampledPoints?: number;
    method?: string;
    status: 'good' | 'warning' | 'critical';
  };
  overhang: {
    angle: number;
    areas: number;
    maxAngle?: number;
    averageAngle?: number;
    faceRatio?: number;
    area?: number;
    samplePoints?: Array<{ x: number; y: number; z: number; angle: number }>;
    status: 'good' | 'warning' | 'critical';
  };
  volume: number;
  boundingBoxVolume?: number;
  surfaceArea: number;
  dims: { x: number; y: number; z: number };
  mesh?: {
    faceCount: number;
    vertexCount: number;
    degenerateFaces: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
    isWatertight: boolean;
    centerOfMass: { x: number; y: number; z: number };
  };
  holes?: {
    count: number;
    boundaryLoops: Array<{
      center: { x: number; y: number; z: number };
      diameter: number;
      radius: number;
      axis: { x: number; y: number; z: number };
      vertices: number;
      type: 'boundary-loop' | 'non-manifold';
    }>;
  };
}

export interface RuleResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  needsAI: boolean;
  category: string;
}

// Quick local analysis report — no API
export function generateQuickReport(model: ModelData, lang: 'en' | 'ja' | 'zh'): string {
  const issues: string[] = [];
  const tips: string[] = [];

  if (model.wallThickness.status === 'critical') {
    issues.push(lang === 'zh' ? `壁厚过薄 (${model.wallThickness.minThickness.toFixed(2)}mm) — 打印风险高` :
      lang === 'ja' ? `壁厚が薄すぎます (${model.wallThickness.minThickness.toFixed(2)}mm) — 印刷リスク高` :
      `Wall too thin (${model.wallThickness.minThickness.toFixed(2)}mm) — high failure risk`);
  } else if (model.wallThickness.status === 'warning') {
    tips.push(lang === 'zh' ? `壁厚偏薄，建议加厚至2mm以上` :
      lang === 'ja' ? `壁厚がやや薄い。2mm以上を推奨` :
      `Walls thin — recommend increasing to 2mm+`);
  }

  if (model.overhang.status === 'warning' || model.overhang.status === 'critical') {
    issues.push(lang === 'zh' ? `${model.overhang.areas} 个悬垂面超过45°，需要支撑` :
      lang === 'ja' ? `${model.overhang.areas}面が45°超 — サポート必要` :
      `${model.overhang.areas} faces exceed 45° — support structures required`);
  }

  const volume = model.volume;
  const material = volume > 500000 ? (lang === 'zh' ? 'FDM (大型件)' : lang === 'ja' ? 'FDM（大型）' : 'FDM (large part)') :
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
    lang === 'zh' ? `真实网格体积: ${model.volume.toFixed(1)} mm³  表面积: ${model.surfaceArea.toFixed(1)} mm²` :
    lang === 'ja' ? `実メッシュ体積: ${model.volume.toFixed(1)} mm³  表面積: ${model.surfaceArea.toFixed(1)} mm²` :
    `Mesh volume: ${model.volume.toFixed(1)} mm³  Surface area: ${model.surfaceArea.toFixed(1)} mm²`,
    lang === 'zh' ? `壁厚采样: 最小 ${model.wallThickness.minThickness.toFixed(2)}mm / 平均 ${fmt(model.wallThickness.averageThickness)}mm (${model.wallThickness.sampledPoints ?? 0} 点)` :
    lang === 'ja' ? `壁厚サンプル: 最小 ${model.wallThickness.minThickness.toFixed(2)}mm / 平均 ${fmt(model.wallThickness.averageThickness)}mm (${model.wallThickness.sampledPoints ?? 0} 点)` :
    `Wall samples: min ${model.wallThickness.minThickness.toFixed(2)}mm / avg ${fmt(model.wallThickness.averageThickness)}mm (${model.wallThickness.sampledPoints ?? 0} pts)`,
    lang === 'zh' ? `悬垂: ${model.overhang.areas} 面, 最大 ${fmt(model.overhang.maxAngle)}°, 面积 ${fmt(model.overhang.area)} mm²` :
    lang === 'ja' ? `オーバーハング: ${model.overhang.areas}面, 最大 ${fmt(model.overhang.maxAngle)}°, 面積 ${fmt(model.overhang.area)} mm²` :
    `Overhangs: ${model.overhang.areas} faces, max ${fmt(model.overhang.maxAngle)}°, area ${fmt(model.overhang.area)} mm²`,
    lang === 'zh' ? `孔/开口: ${formatHoleSummary(model, 'zh')}` :
    lang === 'ja' ? `穴/開口: ${formatHoleSummary(model, 'ja')}` :
    `Holes/openings: ${formatHoleSummary(model, 'en')}`,
    lang === 'zh' ? `推荐工艺: ${material}` : lang === 'ja' ? `推奨工法: ${material}` : `Recommended: ${material}`,
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
    { pattern: /(hole|孔|孔位|穴|opening|开口|開口)/, category: 'holes' },
    { pattern: /(volume|体积|体積|surface|面积|面積)/, category: 'geometry' },
    { pattern: /(risk|problem|issue|风险|問題|リスク)/, category: 'printability' },
  ];

  for (const { pattern, category } of simplePatterns) {
    if (pattern.test(q)) return { needsAI: false, category };
  }

  // Complex questions → AI
  return { needsAI: true, category: 'complex' };
}

// Local answers for common questions
export function answerLocally(category: string, model: ModelData, lang: 'en' | 'ja' | 'zh'): string {
  const isZh = lang === 'zh', isJa = lang === 'ja';

  switch (category) {
    case 'printability': {
      const ok = model.wallThickness.status !== 'critical' && model.overhang.status !== 'critical';
      const reasons = buildRiskReasons(model, lang);
      const base = ok
        ? (isZh ? '根据当前 STL 几何数据，该模型整体可打印。' : isJa ? '現在のSTL幾何データでは、このモデルは概ね印刷可能です。' : 'Based on the STL geometry, this model is generally printable.')
        : (isZh ? '根据当前 STL 几何数据，模型存在打印风险。' : isJa ? '現在のSTL幾何データでは、印刷リスクがあります。' : 'Based on the STL geometry, this model has print risks.');
      return ok
        ? `${base}\n${geometryEvidence(model, lang)}`
        : `${base}\n${reasons.join('\n')}\n${geometryEvidence(model, lang)}`;
    }
    case 'material': {
      const v = model.volume;
      const evidence = isZh ? `依据：体积 ${v.toFixed(0)}mm³，尺寸 ${dims(model)}，最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm。` :
        isJa ? `根拠: 体積 ${v.toFixed(0)}mm³、寸法 ${dims(model)}、最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm。` :
        `Evidence: volume ${v.toFixed(0)}mm³, dims ${dims(model)}, min wall ${model.wallThickness.minThickness.toFixed(2)}mm.`;
      if (v > 500000) return `${isZh ? '推荐 FDM。大型件用 FDM 成本和成型尺寸更合适，材料优先 PLA/PETG，受热或受力再考虑 ABS/ASA。' : isJa ? 'FDM推奨。大型部品は造形サイズとコスト面でFDMが適します。材料はPLA/PETG優先、耐熱・強度が必要ならABS/ASA。' : 'Recommend FDM. For this size, FDM has the best build-volume and cost fit; start with PLA/PETG, use ABS/ASA for heat or load.'}\n${evidence}`;
      if (v > 50000) return `${isZh ? '推荐 FDM 或 SLA：若关注成本/强度选 FDM，若关注表面和细节选 SLA。' : isJa ? 'FDMまたはSLA推奨: コスト/強度ならFDM、表面と細部ならSLA。' : 'Recommend FDM or SLA: use FDM for cost/strength, SLA for surface finish and detail.'}\n${evidence}`;
      return `${isZh ? '推荐 SLA / SLS。该体积偏小，适合追求细节和表面质量；若只是快速验证，也可用 FDM。' : isJa ? 'SLA / SLS推奨。小型なので細部と表面品質に向きます。試作だけならFDMも可。' : 'Recommend SLA / SLS. The part is small enough to benefit from detail and finish; FDM is fine for quick validation.'}\n${evidence}`;
    }
    case 'support': {
      const needs = model.overhang.status !== 'good';
      return needs
        ? (isZh ? `需要支撑。检测到 ${model.overhang.areas} 个面超过45°，最大悬垂约 ${fmt(model.overhang.maxAngle)}°，悬垂面积约 ${fmt(model.overhang.area)}mm²。建议开启自动支撑，并优先检查这些位置：${formatOverhangPoints(model, 'zh')}` : isJa ? `サポートが必要です。45°超の面が${model.overhang.areas}個、最大角は約${fmt(model.overhang.maxAngle)}°、面積は約${fmt(model.overhang.area)}mm²です。自動サポートを有効にし、位置を確認: ${formatOverhangPoints(model, 'ja')}` : `Support is required. ${model.overhang.areas} faces exceed 45°, max overhang is about ${fmt(model.overhang.maxAngle)}°, affected area about ${fmt(model.overhang.area)}mm². Enable support and inspect: ${formatOverhangPoints(model, 'en')}`)
        : (isZh ? `通常不需要支撑。当前采样没有发现超过45°的下-facing 悬垂面。${geometryEvidence(model, 'zh')}` : isJa ? `通常はサポート不要です。45°超の下向き面は検出されていません。${geometryEvidence(model, 'ja')}` : `Support is probably not needed. No downward-facing faces over 45° were detected. ${geometryEvidence(model, 'en')}`);
    }
    case 'settings':
      return settingsAnswer(model, lang);
    case 'time': {
      const vol = model.volume / 1000;
      const mins = Math.round(vol * 0.8 + 20);
      return isZh ? `预计打印时间：${mins}–${mins + 30} 分钟（基于体积估算，FDM 0.2mm层高）。实际时间取决于切片设置。` :
        isJa ? `推定印刷時間: ${mins}〜${mins + 30}分（体積推定、FDM 0.2mm）。実際はスライサー設定による。` :
        `Estimated print time: ${mins}–${mins + 30} min (volume-based, FDM 0.2mm). Actual time depends on slicer settings.`;
    }
    case 'cost': {
      const grams = model.volume * 0.00124;
      const cost = (grams * 0.025).toFixed(2);
      return isZh ? `材料成本估算：约 ¥${(parseFloat(cost) * 7).toFixed(1)}（PLA，按真实网格体积 ${model.volume.toFixed(0)}mm³ 估算，约 ${grams.toFixed(1)}g）。不含机器、人工、支撑和后处理。` :
        isJa ? `材料コスト概算: 約￥${(parseFloat(cost) * 150).toFixed(0)}（PLA、実メッシュ体積 ${model.volume.toFixed(0)}mm³、約${grams.toFixed(1)}g）。機械・人件費・サポート・後処理は含みません。` :
        `Material cost estimate: ~$${cost} for PLA, based on actual mesh volume ${model.volume.toFixed(0)}mm³ (~${grams.toFixed(1)}g). Excludes machine time, support waste, labor, and finishing.`;
    }
    case 'geometry':
      return geometryEvidence(model, lang);
    case 'holes':
      return holesAnswer(model, lang);
    default:
      return localGeometryAnswer(model, lang);
  }
}

export function localGeometryAnswer(model: ModelData, lang: 'en' | 'ja' | 'zh'): string {
  const isZh = lang === 'zh', isJa = lang === 'ja';
  const risks = buildRiskReasons(model, lang);
  const heading = isZh ? 'LOCAL MODE 基于已解析 STL 几何数据回答：' :
    isJa ? 'LOCAL MODE は解析済みSTL幾何データに基づいて回答します:' :
    'LOCAL MODE answer based on parsed STL geometry:';

  return [
    heading,
    geometryEvidence(model, lang),
    risks.length > 0
      ? risks.join('\n')
      : (isZh ? '未检测到明确的壁厚或悬垂红线；仍建议在切片软件中复核方向、支撑和缩放单位。' :
        isJa ? '壁厚・オーバーハングの明確な重大リスクは検出されていません。スライサーで向き、サポート、単位を確認してください。' :
        'No hard wall-thickness or overhang red flags were detected; still verify orientation, supports, and units in the slicer.'),
  ].join('\n');
}

function geometryEvidence(model: ModelData, lang: 'en' | 'ja' | 'zh') {
  const watertight = model.mesh?.isWatertight;
  const meshLine = lang === 'zh'
    ? `网格: ${model.mesh?.faceCount ?? 0} 三角面, ${watertight ? '封闭' : '非封闭/有边界'}, 边界边 ${model.mesh?.boundaryEdges ?? 0}, 非流形边 ${model.mesh?.nonManifoldEdges ?? 0}`
    : lang === 'ja'
    ? `メッシュ: ${model.mesh?.faceCount ?? 0}三角面, ${watertight ? '閉じた形状' : '開いた/境界あり'}, 境界エッジ ${model.mesh?.boundaryEdges ?? 0}, 非多様体エッジ ${model.mesh?.nonManifoldEdges ?? 0}`
    : `Mesh: ${model.mesh?.faceCount ?? 0} triangles, ${watertight ? 'watertight' : 'open/boundary edges present'}, boundary edges ${model.mesh?.boundaryEdges ?? 0}, non-manifold edges ${model.mesh?.nonManifoldEdges ?? 0}`;

  if (lang === 'zh') {
    return [
      `尺寸: ${dims(model)}`,
      `真实体积: ${model.volume.toFixed(1)}mm³; 表面积: ${model.surfaceArea.toFixed(1)}mm²`,
      `壁厚: 最小 ${model.wallThickness.minThickness.toFixed(2)}mm, 平均 ${fmt(model.wallThickness.averageThickness)}mm, 采样 ${model.wallThickness.sampledPoints ?? 0} 点`,
      `悬垂: ${model.overhang.areas} 面 >45°, 最大 ${fmt(model.overhang.maxAngle)}°, 面积 ${fmt(model.overhang.area)}mm²`,
      `孔/开口: ${formatHoleSummary(model, 'zh')}`,
      meshLine,
    ].join('\n');
  }

  if (lang === 'ja') {
    return [
      `寸法: ${dims(model)}`,
      `実体積: ${model.volume.toFixed(1)}mm³; 表面積: ${model.surfaceArea.toFixed(1)}mm²`,
      `壁厚: 最小 ${model.wallThickness.minThickness.toFixed(2)}mm, 平均 ${fmt(model.wallThickness.averageThickness)}mm, サンプル ${model.wallThickness.sampledPoints ?? 0}点`,
      `オーバーハング: ${model.overhang.areas}面 >45°, 最大 ${fmt(model.overhang.maxAngle)}°, 面積 ${fmt(model.overhang.area)}mm²`,
      `穴/開口: ${formatHoleSummary(model, 'ja')}`,
      meshLine,
    ].join('\n');
  }

  return [
    `Dimensions: ${dims(model)}`,
    `Actual mesh volume: ${model.volume.toFixed(1)}mm³; surface area: ${model.surfaceArea.toFixed(1)}mm²`,
    `Wall thickness: min ${model.wallThickness.minThickness.toFixed(2)}mm, avg ${fmt(model.wallThickness.averageThickness)}mm, ${model.wallThickness.sampledPoints ?? 0} samples`,
    `Overhangs: ${model.overhang.areas} faces >45°, max ${fmt(model.overhang.maxAngle)}°, area ${fmt(model.overhang.area)}mm²`,
    `Holes/openings: ${formatHoleSummary(model, 'en')}`,
    meshLine,
  ].join('\n');
}

function buildRiskReasons(model: ModelData, lang: 'en' | 'ja' | 'zh') {
  const reasons: string[] = [];
  const thin = model.wallThickness.minThickness < 1;
  const marginal = model.wallThickness.minThickness >= 1 && model.wallThickness.minThickness < 2;

  if (thin) {
    reasons.push(lang === 'zh' ? `风险: 最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm < 1.0mm，FDM/SLA 都容易破损或打印失败。` :
      lang === 'ja' ? `リスク: 最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm < 1.0mm。FDM/SLAとも破損・失敗しやすいです。` :
      `Risk: min wall ${model.wallThickness.minThickness.toFixed(2)}mm is below 1.0mm, which is fragile for FDM/SLA.`);
  } else if (marginal) {
    reasons.push(lang === 'zh' ? `注意: 最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm 偏薄，建议关键区域加到 2.0mm+。` :
      lang === 'ja' ? `注意: 最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm は薄めです。重要部は2.0mm以上を推奨。` :
      `Caution: min wall ${model.wallThickness.minThickness.toFixed(2)}mm is thin; use 2.0mm+ for critical areas.`);
  }

  if (model.overhang.areas > 0) {
    reasons.push(lang === 'zh' ? `风险: ${model.overhang.areas} 个面超过45°悬垂，最大约 ${fmt(model.overhang.maxAngle)}°，需要支撑或重新摆放。` :
      lang === 'ja' ? `リスク: 45°超のオーバーハングが${model.overhang.areas}面、最大約${fmt(model.overhang.maxAngle)}°。サポートまたは向き変更が必要です。` :
      `Risk: ${model.overhang.areas} faces exceed 45° overhang, max about ${fmt(model.overhang.maxAngle)}°; supports or reorientation are needed.`);
  }

  if (model.mesh && !model.mesh.isWatertight) {
    reasons.push(lang === 'zh' ? `风险: 网格不是完全封闭体，发现 ${model.mesh.boundaryEdges} 条边界边和 ${model.mesh.nonManifoldEdges} 条非流形边。` :
      lang === 'ja' ? `リスク: メッシュが完全閉鎖ではありません。境界エッジ${model.mesh.boundaryEdges}、非多様体エッジ${model.mesh.nonManifoldEdges}。` :
      `Risk: mesh is not fully watertight: ${model.mesh.boundaryEdges} boundary edges and ${model.mesh.nonManifoldEdges} non-manifold edges.`);
  }

  return reasons;
}

function settingsAnswer(model: ModelData, lang: 'en' | 'ja' | 'zh') {
  const thinWall = model.wallThickness.minThickness < 2;
  const needsSupport = model.overhang.areas > 0;

  if (lang === 'zh') {
    return [
      `推荐设置基于几何数据：尺寸 ${dims(model)}，体积 ${model.volume.toFixed(0)}mm³，最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm。`,
      `FDM: 层高 0.2mm，线宽 0.4mm，外墙 ${thinWall ? '4+' : '3'} 圈，填充 ${model.volume > 500000 ? '15-20%' : '20-30%'}。`,
      needsSupport ? `支撑: 开启，阈值 45°，重点检查 ${formatOverhangPoints(model, 'zh')}。` : '支撑: 可先关闭或只启用接触平台支撑，再在切片预览中确认。',
    ].join('\n');
  }

  if (lang === 'ja') {
    return [
      `推奨設定は幾何データに基づきます: 寸法 ${dims(model)}、体積 ${model.volume.toFixed(0)}mm³、最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm。`,
      `FDM: 積層0.2mm、線幅0.4mm、外壁${thinWall ? '4+' : '3'}周、充填${model.volume > 500000 ? '15-20%' : '20-30%'}。`,
      needsSupport ? `サポート: 有効、しきい値45°、確認位置 ${formatOverhangPoints(model, 'ja')}。` : 'サポート: まず無効またはビルドプレートのみで確認してください。',
    ].join('\n');
  }

  return [
    `Recommended settings based on geometry: dims ${dims(model)}, volume ${model.volume.toFixed(0)}mm³, min wall ${model.wallThickness.minThickness.toFixed(2)}mm.`,
    `FDM: 0.2mm layer, 0.4mm line width, ${thinWall ? '4+' : '3'} perimeters, ${model.volume > 500000 ? '15-20%' : '20-30%'} infill.`,
    needsSupport ? `Supports: enable at 45° threshold and inspect ${formatOverhangPoints(model, 'en')}.` : 'Supports: start disabled or build-plate-only, then verify in slicer preview.',
  ].join('\n');
}

function holesAnswer(model: ModelData, lang: 'en' | 'ja' | 'zh') {
  const holes = model.holes?.boundaryLoops ?? [];

  if (holes.length === 0) {
    return lang === 'zh' ? `未检测到开放边界孔环。网格封闭性: ${model.mesh?.isWatertight ? '封闭' : '非封闭'}。注意：封闭实体内部的贯穿孔不会表现为开放边界，本地引擎只能确认 STL 边界开口。` :
      lang === 'ja' ? `開いた境界ループは検出されていません。メッシュ: ${model.mesh?.isWatertight ? '閉鎖' : '非閉鎖'}。閉じた貫通穴は境界として現れないため、LOCAL MODEではSTL境界開口を確認します。` :
      `No open boundary hole loops were detected. Mesh watertight: ${model.mesh?.isWatertight ? 'yes' : 'no'}. Note: closed through-holes do not appear as boundary edges, so LOCAL MODE reports STL boundary openings.`;
  }

  const lines = holes.slice(0, 6).map((hole, index) => {
    const center = `${hole.center.x.toFixed(1)}, ${hole.center.y.toFixed(1)}, ${hole.center.z.toFixed(1)}`;
    return `${index + 1}. center (${center}) mm, diameter ${hole.diameter.toFixed(2)}mm, axis (${hole.axis.x.toFixed(2)}, ${hole.axis.y.toFixed(2)}, ${hole.axis.z.toFixed(2)})`;
  });

  return lang === 'zh' ? `检测到 ${holes.length} 个开放边界孔/开口：\n${lines.join('\n')}` :
    lang === 'ja' ? `${holes.length}個の開いた境界穴/開口を検出:\n${lines.join('\n')}` :
    `Detected ${holes.length} open boundary holes/openings:\n${lines.join('\n')}`;
}

function formatHoleSummary(model: ModelData, lang: 'en' | 'ja' | 'zh') {
  const holes = model.holes?.boundaryLoops ?? [];
  if (holes.length === 0) {
    return lang === 'zh' ? '未发现开放边界孔环' :
      lang === 'ja' ? '開いた境界ループなし' :
      'no open boundary loops';
  }

  return holes
    .slice(0, 3)
    .map(hole => `D${hole.diameter.toFixed(1)} @ (${hole.center.x.toFixed(1)}, ${hole.center.y.toFixed(1)}, ${hole.center.z.toFixed(1)})`)
    .join('; ');
}

function formatOverhangPoints(model: ModelData, lang: 'en' | 'ja' | 'zh') {
  const points = model.overhang.samplePoints ?? [];
  if (points.length === 0) {
    return lang === 'zh' ? '无明确悬垂采样点' : lang === 'ja' ? '明確なサンプル点なし' : 'no specific sample points';
  }

  return points
    .slice(0, 3)
    .map(point => `(${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)})/${point.angle.toFixed(0)}°`)
    .join(', ');
}

function dims(model: ModelData) {
  return `${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm`;
}

function fmt(value?: number) {
  return Number.isFinite(value) ? value!.toFixed(2) : 'n/a';
}
