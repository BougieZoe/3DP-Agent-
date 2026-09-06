import type { UnifiedAnalysis, MetricsResult } from '../analysis/types';

export interface ProcessRecommendation {
  processId: string;
  processName: string;
  fit: 'optimal' | 'viable' | 'marginal' | 'not-recommended';
  confidence: number;
  reasons: string[];
  warnings: string[];
  estimatedMinWallMm: number;
  maxBuildVolumeMm: { x: number; y: number; z: number };
  materialExamples: string[];
}

export type ManufacturingGoal = 'prototype' | 'production' | 'large-format' | 'high-detail';

const PROCESSES = [
  {
    id: 'fdm',
    name: 'FDM (Fused Deposition Modeling)',
    maxWallMm: 0.8,
    minDetailMm: 0.4,
    buildVol: { x: 256, y: 256, z: 256 },
    materials: ['PLA', 'PETG', 'ABS', 'TPU', 'Nylon', 'PC'],
    strengths: ['cost-effective', 'wide material range', 'fast turnaround'],
    weaknesses: ['layer lines visible', 'anisotropic strength', 'support marks'],
  },
  {
    id: 'fgf',
    name: 'FGF (Fused Granulate Fabrication)',
    maxWallMm: 2.0,
    minDetailMm: 1.0,
    buildVol: { x: 1800, y: 1200, z: 1300 },
    materials: ['PETG pellet', 'ABS pellet', 'PP', 'PA', 'recycled plastics'],
    strengths: ['very large parts', 'low material cost', 'fast print speed', 'sustainable materials'],
    weaknesses: ['lower detail resolution', 'visible nozzle lines', 'limited fine features'],
  },
  {
    id: 'sla',
    name: 'SLA (Stereolithography)',
    maxWallMm: 0.3,
    minDetailMm: 0.1,
    buildVol: { x: 200, y: 200, z: 200 },
    materials: ['Standard resin', 'Tough resin', 'Flexible resin', 'Castable resin', 'Dental resin'],
    strengths: ['highest surface finish', 'fine detail', 'smooth walls', 'isotropic'],
    weaknesses: ['brittle', 'limited material range', 'post-processing required', 'UV sensitive'],
  },
  {
    id: 'slm',
    name: 'SLM (Selective Laser Melting)',
    maxWallMm: 0.4,
    minDetailMm: 0.2,
    buildVol: { x: 300, y: 300, z: 300 },
    materials: ['Titanium Ti6Al4V', 'Stainless Steel 316L', 'AlSi10Mg', 'Inconel 718', 'Cobalt Chrome'],
    strengths: ['metal parts', 'high strength', 'complex geometry', 'aerospace grade'],
    weaknesses: ['very expensive', 'requires support removal', 'residual stress', 'long lead time'],
  },
  {
    id: 'sls',
    name: 'SLS (Selective Laser Sintering)',
    maxWallMm: 0.7,
    minDetailMm: 0.3,
    buildVol: { x: 300, y: 300, z: 300 },
    materials: ['Nylon PA12', 'Nylon PA11', 'TPU', 'PP', 'Glass-filled Nylon'],
    strengths: ['no support needed', 'functional parts', 'good for assemblies', 'repeatable'],
    weaknesses: ['porous surface', 'limited color', 'powder handling', 'higher cost than FDM'],
  },
] as const;

function getMaxDim(dims: { x: number; y: number; z: number }): number {
  return Math.max(dims.x, dims.y, dims.z);
}

function recommendProcess(
  process: typeof PROCESSES[number],
  analysis: UnifiedAnalysis,
  goal: ManufacturingGoal,
): ProcessRecommendation {
  const metrics = analysis.metrics?.result;
  const fgf = analysis.fgf?.result;
  const validation = analysis.validation?.result;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  let maxScore = 0;

  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const maxDim = getMaxDim(dims);
  const minWall = metrics?.minWallThicknessMm ?? Infinity;
  const volume = metrics?.meshVolumeMm3 ?? 0;
  const overhang = metrics?.overhang;
  const isWatertight = validation?.isWatertight ?? true;

  // Build volume check
  maxScore += 30;
  const fitsVolume = dims.x <= process.buildVol.x && dims.y <= process.buildVol.y && dims.z <= process.buildVol.z;
  if (fitsVolume) {
    score += 30;
    reasons.push(`Fits within ${process.buildVol.x}×${process.buildVol.y}×${process.buildVol.z}mm build volume`);
  } else {
    const overflow = Math.max(
      dims.x - process.buildVol.x,
      dims.y - process.buildVol.y,
      dims.z - process.buildVol.z,
    );
    warnings.push(`Exceeds build volume by ${overflow.toFixed(0)}mm — requires splitting or larger machine`);
  }

  // Wall thickness check
  maxScore += 25;
  if (minWall >= process.maxWallMm) {
    score += 25;
    reasons.push(`Min wall ${minWall.toFixed(2)}mm exceeds ${process.name.split('(')[0].trim()} minimum of ${process.maxWallMm}mm`);
  } else if (minWall >= process.maxWallMm * 0.6) {
    score += 12;
    warnings.push(`Min wall ${minWall.toFixed(2)}mm is marginal for ${process.name.split('(')[0].trim()} (min ${process.maxWallMm}mm)`);
  } else if (minWall !== Infinity && minWall > 0) {
    warnings.push(`Min wall ${minWall.toFixed(2)}mm is below ${process.name.split('(')[0].trim()} minimum of ${process.maxWallMm}mm — may fail`);
  }

  // Size-based process affinity
  maxScore += 20;
  if (process.id === 'fgf') {
    if (maxDim > 500) {
      score += 20;
      reasons.push(`Large part (${maxDim.toFixed(0)}mm) — FGF is optimal for oversized geometry`);
    } else if (maxDim > 300) {
      score += 10;
      reasons.push(`Medium-large part — FGF viable for faster production`);
    } else {
      score += 3;
      warnings.push(`Small part — FGF available but FDM may be more cost-effective`);
    }
  } else if (process.id === 'fdm') {
    if (maxDim <= 256) {
      score += 20;
      reasons.push(`Standard build volume — FDM is cost-effective`);
    } else {
      score += 0;
    }
  } else if (process.id === 'sla') {
    if (maxDim <= 200 && minWall < 1.0) {
      score += 20;
      reasons.push('High-detail part — SLA provides best surface finish');
    } else {
      score += 5;
    }
  } else if (process.id === 'slm') {
    score += 8;
    if (volume < 100000) {
      reasons.push('Metal printing available for small-to-medium functional parts');
    }
  } else if (process.id === 'sls') {
    score += 10;
    reasons.push('No support structures needed — good for complex geometry');
  }

  // Goal alignment
  maxScore += 15;
  if (goal === 'large-format' && process.id === 'fgf') {
    score += 15;
    reasons.push('Matches large-format production goal');
  } else if (goal === 'high-detail' && (process.id === 'sla' || process.id === 'slm')) {
    score += 15;
    reasons.push('Matches high-detail requirement');
  } else if (goal === 'prototype' && (process.id === 'fdm' || process.id === 'sla')) {
    score += 15;
    reasons.push('Fast turnaround for prototyping');
  } else if (goal === 'production' && (process.id === 'sls' || process.id === 'slm')) {
    score += 15;
    reasons.push('Repeatable process for production runs');
  } else {
    score += 5;
  }

  // Overhang penalty for processes that need supports
  maxScore += 10;
  if (overhang && overhang.severity === 'severe' && process.id !== 'sls') {
    warnings.push('Severe overhangs will require support structures');
  } else if (overhang && overhang.severity === 'none') {
    score += 10;
    reasons.push('No overhangs — minimal support needed');
  } else {
    score += 5;
  }

  // Watertight bonus for SLA
  if (!isWatertight && process.id === 'sla') {
    warnings.push('Non-watertight mesh may trap uncured resin');
  }

  const confidence = Math.min(1, score / maxScore);
  const fit: ProcessRecommendation['fit'] =
    confidence >= 0.7 ? 'optimal' :
    confidence >= 0.5 ? 'viable' :
    confidence >= 0.3 ? 'marginal' :
    'not-recommended';

  return {
    processId: process.id,
    processName: process.name,
    fit,
    confidence,
    reasons,
    warnings,
    estimatedMinWallMm: process.maxWallMm,
    maxBuildVolumeMm: process.buildVol,
    materialExamples: [...process.materials],
  };
}

export function recommendManufacturing(
  analysis: UnifiedAnalysis,
  goal: ManufacturingGoal = 'prototype',
): ProcessRecommendation[] {
  return PROCESSES
    .map(p => recommendProcess(p, analysis, goal))
    .sort((a, b) => b.confidence - a.confidence);
}
