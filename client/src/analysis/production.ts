// client/src/analysis/production.ts
//
// Production-suitability assessment — "can this part be mass-produced?"
//
// HONESTY NOTE: this is a DIRECTIONAL ESTIMATE, not a manufacturing quote.
// A real production decision needs target volume, dimensional tolerance,
// surface finish, QC yield, post-processing labour and supply chain — none of
// which an STL reveals. What the geometry + process DO tell us:
//
//   - Parts per build: how many copies of the bounding box fit in a
//     representative build volume (≈60% nesting efficiency).
//   - Per-part cost: powder-bed processes (SLS/SLM/MJF) build N parts in one
//     run and amortize machine time across the batch; serial processes (FDM,
//     resin) pay per part.
//   - Process production-friendliness: SLS/MJF are batch-production
//     technologies, FDM/resin lean prototyping, metal is high-cost small-batch.

import type { UnifiedAnalysis } from './types';
import type { Material } from '@shared/domain/material';

/** Representative build volume (mm) per technology. Concrete is single-piece construction. */
const BUILD_VOLUME_MM: Record<string, [number, number, number] | null> = {
  fdm: [220, 220, 250],
  sla: [143, 89, 175],
  fgf: [1000, 1000, 1000],
  sls: [300, 300, 300],
  slm: [250, 250, 325],
  mjf: [380, 284, 380],
  eco: [220, 220, 250],
  concrete: null,
};

/** Base production-friendliness (0–100) per process. */
const PROCESS_BASE: Record<string, number> = {
  fdm: 45, sla: 40, fgf: 35, sls: 85, slm: 65, mjf: 90, eco: 45, concrete: 20,
};

const BATCH_PROCESSES = new Set(['sls', 'slm', 'mjf']);

export interface ProductionSuitability {
  /** 0–100 directional production score. */
  score: number;
  /** Estimated copies per build (1 when the part exceeds the build volume). */
  partsPerBatch: number;
  /** Estimated cost per part (powder bed amortizes machine time). */
  perPartCostUsd: number;
  verdict: 'production' | 'small-batch' | 'prototype';
  /** One-line human verdict. */
  note: string;
}

export function productionFromUnified(unified: UnifiedAnalysis, material: Material): ProductionSuitability | null {
  const m = unified.metrics?.result;
  const pt = unified.printTime?.result;
  if (!m || !pt || m.meshVolumeMm3 <= 0) return null;

  const dims = m.boundingBoxDimensionsMm;
  const build = BUILD_VOLUME_MM[material.technology] ?? null;

  let partsPerBatch = 1;
  if (build) {
    const fits = (part: number, avail: number) => (part > 0 ? Math.floor(avail / part) : 1);
    const nx = fits(dims.x, build[0]);
    const ny = fits(dims.y, build[1]);
    const nz = fits(dims.z, build[2]);
    partsPerBatch = Math.max(1, Math.floor(nx * ny * nz * 0.6)); // ~60% nesting efficiency
  }

  // Per-part cost: batch processes build N in one run (machine time shared);
  // serial processes pay per part.
  const machineCost = Math.max(0, pt.totalCostUsd - (pt.materialCostUsd ?? 0));
  const isBatch = BATCH_PROCESSES.has(material.technology);
  const perPartCostUsd = isBatch
    ? (pt.materialCostUsd ?? 0) + machineCost / Math.max(1, partsPerBatch)
    : pt.totalCostUsd;

  let score = PROCESS_BASE[material.technology] ?? 50;
  if (partsPerBatch <= 1) score -= 25;
  else if (partsPerBatch <= 5) score -= 10;
  else if (partsPerBatch >= 20) score += 5;
  if (perPartCostUsd > 50) score -= 15;
  else if (perPartCostUsd > 20) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const verdict: ProductionSuitability['verdict'] = score >= 70 ? 'production' : score >= 40 ? 'small-batch' : 'prototype';

  const note = build === null
    ? 'Single-piece construction process — batch production does not apply.'
    : `${material.technology.toUpperCase()}: ~${partsPerBatch} parts per build, ~$${perPartCostUsd.toFixed(2)}/part — ${verdict}.`;

  return { score, partsPerBatch, perPartCostUsd, verdict, note };
}
