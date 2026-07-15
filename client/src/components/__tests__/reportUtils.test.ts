import { describe, it, expect } from 'vitest';
import type { UnifiedAnalysis } from '@/analysis/types';
import { moduleResult } from '@/analysis/types';
import {
  detectLanguage,
  detectTone,
  getTrafficLight,
  computeWeightRange,
  computeTimeRange,
  buildClientIssues,
  buildDesignerIssues,
} from '@/components/reportUtils';

// ─── Fixtures ─────────────────────────────────────────────────────

function healthyAnalysis(): UnifiedAnalysis {
  return {
    topology: moduleResult('topology', 1.0, 1, {
      triangleCount: 100, vertexCount: 60, edgeCount: 150,
      manifoldEdgeCount: 150, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
      shellCount: 1, isManifold: true, problemEdges: [],
    }, ''),
    validation: moduleResult('validation', 0.8, 1, {
      isWatertight: true, holeCount: 0, boundaryEdgeCount: 0,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, ''),
    metrics: moduleResult('metrics', 0.8, 10, {
      meshVolumeMm3: 10000, surfaceAreaMm2: 2000,
      boundingBoxVolumeMm3: 15000, boundingBoxDimensionsMm: { x: 20, y: 15, z: 50 },
      minWallThicknessMm: 1.2, avgWallThicknessMm: 1.8,
      p1WallThicknessMm: 1.0, p5WallThicknessMm: 1.1, p10WallThicknessMm: 1.2,
      medianWallThicknessMm: 1.8,
      thinWallCount: 2, thinWallPercentage: 1, thinWallRatio: 0.01,
      averageConfidence: 0.8, lowConfidenceSampleCount: 1,
      wallThicknessSamples: [],
      overhang: { faceCount: 5, totalFaceCount: 100, ratio: 0.05, severity: 'moderate', breakdownByAngleDeg: [] },
    }, ''),
    bedFit: moduleResult('bedFit', 1.0, 1, {
      fits: true,
      printerProfile: { id: 'bambu_x1c', name: 'Bambu Lab X1C', widthMm: 256, depthMm: 256, heightMm: 256 },
      modelDimensionsMm: { x: 20, y: 15, z: 50 },
      clearanceMm: { x: 236, y: 241, z: 206 },
      bestOrientation: { x: 0, y: 0, z: 0 },
      orientations: [],
    }, ''),
    support: moduleResult('support', 0.9, 2, {
      totalSupportVolumeMm3: 100, supportFaceCount: 10,
      averageOverhangAngleDeg: 42, difficulty: 'easy',
      estimatedSupportGrams: 0.1,
      volumeByAngleDeg: [{ range: '0-45', volumeMm3: 100, faceCount: 10 }],
      supportRegions: [{ faceCount: 10, centroid: { x: 10, y: 10, z: 10 }, boundingBoxSize: { x: 5, y: 5, z: 5 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 42, estimatedVolumeMm3: 100, zRange: { min: 0, max: 10 } }],
      largestRegionRatio: 1, tallSupportRatio: 0, zGradient: 0, directionality: 0.5,
    }, ''),
    printTime: moduleResult('printTime', 0.9, 1, {
      estimatedPrintTimeMinutes: 180, estimatedPrintTimeHours: 3,
      materialWeightGrams: 25, materialCostUsd: 1.5, totalCostUsd: 2.0,
      layerCount: 250, printerProfile: { id: 'bambu_x1c', name: 'Bambu Lab X1C', widthMm: 256, depthMm: 256, heightMm: 256 },
    }, ''),
    timestamp: '2026-01-01T00:00:00.000Z',
    modelFileName: 'test.stl',
    overallConfidence: 0.8,
  };
}

function failingAnalysis(): UnifiedAnalysis {
  const h = healthyAnalysis();
  return {
    ...h,
    validation: moduleResult('validation', 0.3, 1, {
      isWatertight: false, holeCount: 3, boundaryEdgeCount: 6,
      flippedNormalFaceCount: 20, totalFaceCount: 100,
      flippedNormalRatio: 0.2, normalOrientation: 'mixed',
      degenerateFaceCount: 15,
    }, ''),
    metrics: moduleResult('metrics', 0.4, 10, {
      ...h.metrics.result,
      thinWallRatio: 0.3,
      p5WallThicknessMm: 0.3,
      overhang: { faceCount: 40, totalFaceCount: 100, ratio: 0.4, severity: 'severe', breakdownByAngleDeg: [{ minAngle: 50, maxAngle: 70, faceCount: 40 }] },
      averageConfidence: 0.2,
    }, ''),
    support: moduleResult('support', 0.3, 2, {
      totalSupportVolumeMm3: 5000, supportFaceCount: 200,
      averageOverhangAngleDeg: 65, difficulty: 'very_difficult',
      estimatedSupportGrams: 10,
      volumeByAngleDeg: [{ range: '45-90', volumeMm3: 5000, faceCount: 200 }],
      supportRegions: [
        { faceCount: 120, centroid: { x: 10, y: 10, z: 10 }, boundingBoxSize: { x: 5, y: 5, z: 5 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 65, estimatedVolumeMm3: 3000, zRange: { min: 5, max: 15 } },
        { faceCount: 80, centroid: { x: 20, y: 20, z: 20 }, boundingBoxSize: { x: 3, y: 3, z: 3 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 60, estimatedVolumeMm3: 2000, zRange: { min: 10, max: 20 } },
      ],
      largestRegionRatio: 0.6, tallSupportRatio: 0.4, zGradient: 0.5, directionality: 0.8,
    }, ''),
  };
}

// ─── detectLanguage ───────────────────────────────────────────────

describe('detectLanguage', () => {
  it('detects Japanese from kana/kanji in user messages', () => {
    expect(detectLanguage([
      { role: 'user', content: 'このモデルは印刷できますか' },
    ])).toBe('ja');
  });

  it('defaults to English for non-Japanese text', () => {
    expect(detectLanguage([
      { role: 'user', content: 'Can this model be printed?' },
    ])).toBe('en');
  });

  it('ignores assistant messages', () => {
    expect(detectLanguage([
      { role: 'assistant', content: 'このモデルは大丈夫です' },
      { role: 'user', content: 'Is it watertight?' },
    ])).toBe('en');
  });

  it('handles empty messages', () => {
    expect(detectLanguage([])).toBe('en');
  });
});

// ─── detectTone ───────────────────────────────────────────────────

describe('detectTone', () => {
  it('detects expert tone from technical terms', () => {
    expect(detectTone([
      { role: 'user', content: 'the manifold is not watertight, check overhang angle' },
    ])).toBe('expert');
  });

  it('detects expert tone from long average word length', () => {
    expect(detectTone([
      { role: 'user', content: 'extraordinarily comprehensive multidimensional topology analysis' },
    ])).toBe('expert');
  });

  it('detects friendly tone from casual patterns', () => {
    expect(detectTone([
      { role: 'user', content: 'lol this print is gonna fail haha kinda sucks' },
    ])).toBe('friendly');
  });

  it('detects friendly tone from short average word length', () => {
    expect(detectTone([
      { role: 'user', content: 'u r thx ya know' },
    ])).toBe('friendly');
  });

  it('defaults to professional', () => {
    expect(detectTone([
      { role: 'user', content: 'Can you check this file?' },
    ])).toBe('professional');
  });

  it('handles empty messages', () => {
    expect(detectTone([])).toBe('professional');
  });
});

// ─── getTrafficLight ──────────────────────────────────────────────

describe('getTrafficLight', () => {
  it('returns green for healthy analysis', () => {
    const result = getTrafficLight(healthyAnalysis());
    expect(result.light).toBe('green');
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('returns red for critical issues', () => {
    const result = getTrafficLight(failingAnalysis());
    expect(result.light).toBe('red');
    expect(result.score).toBeLessThan(45);
  });

  it('returns yellow for moderate issues', () => {
    const h = healthyAnalysis();
    const moderate = {
      ...h,
      metrics: moduleResult('metrics', 0.6, 10, {
        ...h.metrics.result,
        thinWallRatio: 0.1,
        p5WallThicknessMm: 0.7,
        overhang: { ...h.metrics.result.overhang, ratio: 0.2 },
      }, ''),
    };
    const result = getTrafficLight(moderate);
    expect(result.light).toBe('yellow');
    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(result.score).toBeLessThan(75);
  });

  it('handles undefined validation/metrics/support gracefully', () => {
    const empty: UnifiedAnalysis = {
      topology: moduleResult('topology', 0.1, 0, {
        triangleCount: 0, vertexCount: 0, edgeCount: 0,
        manifoldEdgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
        shellCount: 0, isManifold: false, problemEdges: [],
      }, 'no data'),
      validation: moduleResult('validation', 0.1, 0, {
        isWatertight: false, holeCount: 0, boundaryEdgeCount: 0,
        flippedNormalFaceCount: 0, totalFaceCount: 0,
        flippedNormalRatio: 0, normalOrientation: 'unknown',
        degenerateFaceCount: 0,
      }, 'no data'),
      metrics: moduleResult('metrics', 0.1, 0, {
        meshVolumeMm3: 0, surfaceAreaMm2: 0,
        boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 },
        minWallThicknessMm: null, avgWallThicknessMm: null,
        p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null,
        thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0, lowConfidenceSampleCount: 0,
        wallThicknessSamples: [],
        overhang: { faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none', breakdownByAngleDeg: [] },
      }, 'no data'),
      bedFit: null,
      support: null,
      printTime: null,
      timestamp: '',
      modelFileName: '',
      overallConfidence: 0,
    };
    const result = getTrafficLight(empty);
    // isWatertight=false deducts 30; low conf (<0.3) with thinWallRatio<0.02 deducts 3
    expect(result.score).toBe(67);
  });
});

// ─── computeWeightRange ───────────────────────────────────────────

describe('computeWeightRange', () => {
  it('computes infill-variable weight range', () => {
    const range = computeWeightRange(100);
    expect(range).toBe('6–120g (varies by infill)');
  });

  it('handles zero grams', () => {
    expect(computeWeightRange(0)).toBe('0–0g (varies by infill)');
  });
});

// ─── computeTimeRange ─────────────────────────────────────────────

describe('computeTimeRange', () => {
  it('computes time range in hours/minutes', () => {
    const range = computeTimeRange(180);
    expect(range).toContain('2h');
    expect(range).toContain('3h');
    expect(range).toContain('excl. supports');
  });

  it('handles short prints', () => {
    const range = computeTimeRange(15);
    expect(range).toContain('m');
  });

  it('handles zero minutes', () => {
    const range = computeTimeRange(0);
    expect(range).toContain('0h 0m');
  });
});

// ─── buildClientIssues ────────────────────────────────────────────

describe('buildClientIssues', () => {
  it('returns no issues for healthy analysis', () => {
    const issues = buildClientIssues(healthyAnalysis(), 'en');
    expect(issues).toHaveLength(0);
  });

  it('reports critical thin walls in English', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.4, 10, {
      ...h.metrics.result, thinWallRatio: 0.3, p5WallThicknessMm: 0.3,
    }, '');
    const issues = buildClientIssues(h, 'en');
    expect(issues.some(i => i.includes('30% of sampled walls'))).toBe(true);
  });

  it('reports critical thin walls in Japanese', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.4, 10, {
      ...h.metrics.result, thinWallRatio: 0.3, p5WallThicknessMm: 0.3,
    }, '');
    const issues = buildClientIssues(h, 'ja');
    expect(issues.some(i => i.includes('壁が薄すぎる'))).toBe(true);
  });

  it('reports warning thin walls in English', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.6, 10, {
      ...h.metrics.result, thinWallRatio: 0.08, p5WallThicknessMm: 0.7,
    }, '');
    const issues = buildClientIssues(h, 'en');
    expect(issues.some(i => i.includes('review recommended'))).toBe(true);
  });

  it('reports warning thin walls in Japanese', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.6, 10, {
      ...h.metrics.result, thinWallRatio: 0.08, p5WallThicknessMm: 0.7,
    }, '');
    const issues = buildClientIssues(h, 'ja');
    expect(issues.some(i => i.includes('壁が薄いです'))).toBe(true);
  });

  it('reports low confidence thin walls', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.2, 10, {
      ...h.metrics.result,
      thinWallRatio: 0.01, averageConfidence: 0.2,
      minWallThicknessMm: 1.5,
    }, '');
    const issues = buildClientIssues(h, 'en');
    expect(issues.some(i => i.includes('Low confidence'))).toBe(true);
    expect(issues.some(i => i.includes('1.50mm'))).toBe(true);
  });

  it('reports low confidence thin walls in Japanese', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.2, 10, {
      ...h.metrics.result,
      thinWallRatio: 0.01, averageConfidence: 0.2,
      minWallThicknessMm: null,
    }, '');
    const issues = buildClientIssues(h, 'ja');
    expect(issues.some(i => i.includes('信頼度が低い'))).toBe(true);
  });

  it('reports non-watertight mesh issues in EN and JA', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.3, 1, {
      isWatertight: false, holeCount: 2, boundaryEdgeCount: 4,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('gaps'))).toBe(true);
    expect(en.some(i => i.includes('2 holes'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('隙間'))).toBe(true);
    expect(ja.some(i => i.includes('穴'))).toBe(true);
  });

  it('reports watertight mesh with holes in EN and JA', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.5, 1, {
      isWatertight: true, holeCount: 1, boundaryEdgeCount: 2,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('1 hole'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('穴'))).toBe(true);
  });

  it('reports non-watertight single hole in EN', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.3, 1, {
      isWatertight: false, holeCount: 1, boundaryEdgeCount: 2,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('1 hole'))).toBe(true);
  });

  it('reports holes even when watertight', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.5, 1, {
      isWatertight: true, holeCount: 1, boundaryEdgeCount: 2,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('1 hole'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('穴'))).toBe(true);
  });

  it('reports flipped normals', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.5, 1, {
      isWatertight: true, holeCount: 0, boundaryEdgeCount: 0,
      flippedNormalFaceCount: 10, totalFaceCount: 100,
      flippedNormalRatio: 0.1, normalOrientation: 'mixed',
      degenerateFaceCount: 0,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('wrong way'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('裏返し'))).toBe(true);
  });

  it('reports critical overhang in EN and JA', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.5, 10, {
      ...h.metrics.result,
      overhang: { faceCount: 60, totalFaceCount: 100, ratio: 0.6, severity: 'severe', breakdownByAngleDeg: [] },
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('support material'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('張り出した'))).toBe(true);
  });

  it('reports warning overhang in EN and JA', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.6, 10, {
      ...h.metrics.result,
      overhang: { faceCount: 15, totalFaceCount: 100, ratio: 0.15, severity: 'moderate', breakdownByAngleDeg: [] },
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('supports'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('張り出した'))).toBe(true);
  });

  it('reports critical support issues in EN and JA', () => {
    const h = healthyAnalysis();
    h.support = moduleResult('support', 0.3, 2, {
      totalSupportVolumeMm3: 5000, supportFaceCount: 200,
      averageOverhangAngleDeg: 70, difficulty: 'very_difficult',
      estimatedSupportGrams: 10,
      volumeByAngleDeg: [{ range: '45-90', volumeMm3: 5000, faceCount: 200 }],
      supportRegions: [
        { faceCount: 120, centroid: { x: 10, y: 10, z: 10 }, boundingBoxSize: { x: 5, y: 5, z: 5 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 70, estimatedVolumeMm3: 3000, zRange: { min: 5, max: 15 } },
      ],
      largestRegionRatio: 1, tallSupportRatio: 0.5, zGradient: 0.5, directionality: 0.8,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('Complex support'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('サポート構造が複雑'))).toBe(true);
  });

  it('reports support warning with reason', () => {
    const h = healthyAnalysis();
    h.support = moduleResult('support', 0.5, 2, {
      totalSupportVolumeMm3: 500, supportFaceCount: 50,
      averageOverhangAngleDeg: 55, difficulty: 'difficult',
      estimatedSupportGrams: 1,
      volumeByAngleDeg: [{ range: '45-90', volumeMm3: 500, faceCount: 50 }],
      supportRegions: [
        { faceCount: 50, centroid: { x: 10, y: 10, z: 10 }, boundingBoxSize: { x: 5, y: 5, z: 5 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 55, estimatedVolumeMm3: 500, zRange: { min: 5, max: 15 } },
      ],
      largestRegionRatio: 0.2, tallSupportRatio: 0.1, zGradient: 0.1, directionality: 0.6,
    }, '');
    const en = buildClientIssues(h, 'en');
    expect(en.some(i => i.includes('Support caution'))).toBe(true);
    const ja = buildClientIssues(h, 'ja');
    expect(ja.some(i => i.includes('サポートに関する注意'))).toBe(true);
  });
});

// ─── buildDesignerIssues ──────────────────────────────────────────

describe('buildDesignerIssues', () => {
  it('returns no issues for healthy analysis', () => {
    const issues = buildDesignerIssues(healthyAnalysis(), 'professional', 'en');
    expect(issues).toHaveLength(0);
  });

  it('reports critical wall issues with percentiles', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.4, 10, {
      ...h.metrics.result, thinWallRatio: 0.3, p5WallThicknessMm: 0.3, p10WallThicknessMm: 0.4,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('30% of samples below FDM threshold'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('広範囲に薄い壁'))).toBe(true);
  });

  it('reports critical walls with p5 fallback', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.4, 10, {
      ...h.metrics.result, thinWallRatio: 0.3, p5WallThicknessMm: null, p10WallThicknessMm: null,
      avgWallThicknessMm: null,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('below FDM'))).toBe(true);
  });

  it('reports warning thin walls in designer mode', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.6, 10, {
      ...h.metrics.result, thinWallRatio: 0.08, p5WallThicknessMm: 0.7, p10WallThicknessMm: 0.8,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('thin'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('薄い'))).toBe(true);
  });

  it('reports warning thin walls with null percentiles', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.6, 10, {
      ...h.metrics.result, thinWallRatio: 0.08, p5WallThicknessMm: null, p10WallThicknessMm: null,
      avgWallThicknessMm: null,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('thin'))).toBe(true);
    expect(en.some(i => i.includes('0.00'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('薄い'))).toBe(true);
  });

  it('reports low confidence walls in designer mode', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.2, 10, {
      ...h.metrics.result,
      thinWallRatio: 0.01, averageConfidence: 0.3,
      minWallThicknessMm: 2.0, p5WallThicknessMm: null,
    }, '');
    const en = buildDesignerIssues(h, 'expert', 'en');
    expect(en.some(i => i.includes('confidence low'))).toBe(true);
    const ja = buildDesignerIssues(h, 'expert', 'ja');
    expect(ja.some(i => i.includes('信頼度が低い'))).toBe(true);
  });

  it('reports low confidence walls with null min in designer mode', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.2, 10, {
      ...h.metrics.result,
      thinWallRatio: 0.01, averageConfidence: 0.3,
      minWallThicknessMm: null, p5WallThicknessMm: null,
    }, '');
    const en = buildDesignerIssues(h, 'expert', 'en');
    expect(en.some(i => i.includes('confidence low'))).toBe(true);
    expect(en.some(i => !i.includes('Min measured'))).toBe(true);
    const ja = buildDesignerIssues(h, 'expert', 'ja');
    expect(ja.some(i => i.includes('信頼度が低い'))).toBe(true);
    expect(ja.some(i => !i.includes('最小測定値'))).toBe(true);
  });

  it('reports flipped normals in EN and JA', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.5, 1, {
      isWatertight: true, holeCount: 0, boundaryEdgeCount: 0,
      flippedNormalFaceCount: 10, totalFaceCount: 100,
      flippedNormalRatio: 0.1, normalOrientation: 'mixed',
      degenerateFaceCount: 0,
    }, '');
    const en = buildDesignerIssues(h, 'expert', 'en');
    expect(en.some(i => i.includes('inverted normals'))).toBe(true);
    const ja = buildDesignerIssues(h, 'expert', 'ja');
    expect(ja.some(i => i.includes('法線が反転'))).toBe(true);
  });

  it('reports non-watertight with holes in designer mode', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.3, 1, {
      isWatertight: false, holeCount: 2, boundaryEdgeCount: 4,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('watertight'))).toBe(true);
    expect(en.some(i => i.includes('2 holes'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('密閉'))).toBe(true);
    expect(ja.some(i => i.includes('穴'))).toBe(true);
  });

  it('reports holes in watertight mesh in designer mode', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.5, 1, {
      isWatertight: true, holeCount: 1, boundaryEdgeCount: 2,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('1 hole'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('穴'))).toBe(true);
  });

  it('reports non-watertight with single hole in designer mode', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.3, 1, {
      isWatertight: false, holeCount: 1, boundaryEdgeCount: 2,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('watertight'))).toBe(true);
    expect(en.some(i => i.includes('1 hole'))).toBe(true);
  });

  it('reports watertight mesh with multiple holes in designer mode', () => {
    const h = healthyAnalysis();
    h.validation = moduleResult('validation', 0.5, 1, {
      isWatertight: true, holeCount: 2, boundaryEdgeCount: 4,
      flippedNormalFaceCount: 0, totalFaceCount: 100,
      flippedNormalRatio: 0, normalOrientation: 'consistent_outward',
      degenerateFaceCount: 0,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('2 holes'))).toBe(true);
  });

  it('reports overhang issues in designer mode', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.5, 10, {
      ...h.metrics.result,
      overhang: { faceCount: 60, totalFaceCount: 100, ratio: 0.6, severity: 'severe', breakdownByAngleDeg: [] },
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('Severe overhang'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('深刻なオーバーハング'))).toBe(true);
  });

  it('reports warning overhang in designer mode', () => {
    const h = healthyAnalysis();
    h.metrics = moduleResult('metrics', 0.6, 10, {
      ...h.metrics.result,
      overhang: { faceCount: 10, totalFaceCount: 100, ratio: 0.1, severity: 'moderate', breakdownByAngleDeg: [] },
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('Moderate overhang'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('中程度のオーバーハング'))).toBe(true);
  });

  it('reports critical support with reason in designer mode', () => {
    const h = healthyAnalysis();
    h.support = moduleResult('support', 0.3, 2, {
      totalSupportVolumeMm3: 5000, supportFaceCount: 200,
      averageOverhangAngleDeg: 70, difficulty: 'very_difficult',
      estimatedSupportGrams: 10,
      volumeByAngleDeg: [{ range: '45-90', volumeMm3: 5000, faceCount: 200 }],
      supportRegions: [
        { faceCount: 200, centroid: { x: 10, y: 10, z: 10 }, boundingBoxSize: { x: 5, y: 5, z: 5 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 70, estimatedVolumeMm3: 5000, zRange: { min: 5, max: 15 } },
      ],
      largestRegionRatio: 0.6, tallSupportRatio: 0.4, zGradient: 0.5, directionality: 0.8,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('Very difficult support structure'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('Very difficult support structure'))).toBe(true);
  });

  it('reports warning support with reasons in designer mode', () => {
    const h = healthyAnalysis();
    h.support = moduleResult('support', 0.5, 2, {
      totalSupportVolumeMm3: 500, supportFaceCount: 50,
      averageOverhangAngleDeg: 55, difficulty: 'difficult',
      estimatedSupportGrams: 1,
      volumeByAngleDeg: [{ range: '45-90', volumeMm3: 500, faceCount: 50 }],
      supportRegions: [
        { faceCount: 50, centroid: { x: 10, y: 10, z: 10 }, boundingBoxSize: { x: 5, y: 5, z: 5 }, normalizedDirection: { x: 0, y: 0, z: 1 }, avgAngleDeg: 55, estimatedVolumeMm3: 500, zRange: { min: 5, max: 15 } },
      ],
      largestRegionRatio: 0.2, tallSupportRatio: 0.1, zGradient: 0.1, directionality: 0.6,
    }, '');
    const en = buildDesignerIssues(h, 'professional', 'en');
    expect(en.some(i => i.includes('Support:'))).toBe(true);
    const ja = buildDesignerIssues(h, 'professional', 'ja');
    expect(ja.some(i => i.includes('サポート:'))).toBe(true);
  });
});
