// client/src/analysis/loop.ts
//
// LOOP analysis — circularity for one printed part: prevent waste
// (first-time-right), plan waste (support-stream fate), end waste (natural end).
//
// Fully RULE-BASED and deterministic: same geometry + material → same numbers
// every run. Scores never come from an LLM (pre-print judgments affect real
// material and money; see the causalityEngine ADR for why determinism wins).
// Explanations are plain English literals like the eco module (i18n later).

import type { SupportDifficulty } from './types';
import type { Material, MaterialEol, MaterialTechnology } from '@shared/domain/material';

/** Where the support/waste stream can go. Ordered best → worst. */
export type WasteFate = 'fgf-direct' | 'recyclable' | 'compostable' | 'landfill';

export interface LoopFirstTime {
  /** 0..100 — probability-flavored printability score (rule-based, not a model). */
  score: number;
  /** Expected cost of failure = (1 − score) × (material + machine cost). */
  expectedFailureCostUsd: number;
  /** Top contributing risks, human-readable, most severe first. */
  drivers: string[];
}

export interface LoopWaste {
  partGrams: number;
  supportGrams: number;
  /** Conventional 10% process loss (brim, purge, scraps) — same convention as SustainabilityCard. */
  processLossGrams: number;
  totalWasteGrams: number;
  /** totalWaste / part mass. Unit-consistent (kg/kg) — the old g/kg bug is covered by tests. */
  wasteRatio: number;
  fate: WasteFate;
  fateReason: string;
  /** Multi-material stream: cannot re-enter any single-material loop. */
  contaminated: boolean;
}

export interface LoopEol {
  /**
   * Months [min, max] to full industrial-compost breakdown, geometry-adjusted.
   * A range on purpose — biodegradation point estimates are precision theater.
   * Null = unknown material.
   */
  monthsCompost: [number, number] | null;
  marineDegradable: boolean;
  /** ≤1 for thin / high-surface parts (they break down faster). */
  geometryFactor: number;
  /** Provenance + the mandatory environment-depends disclaimer. */
  basisNote: string;
}

/** Score bands — the number is heuristic, so the band is the headline. */
export type ScoreBand = 'high' | 'medium' | 'low';

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export interface LoopResult {
  firstTime: LoopFirstTime;
  waste: LoopWaste;
  eol: LoopEol;
}

const SUPPORT_PENALTY: Record<SupportDifficulty, number> = {
  none: 0,
  easy: 5,
  moderate: 12,
  difficult: 22,
  very_difficult: 35,
};

/**
 * Single writer for support-stream fate: the pipeline module AND the
 * process×material matrix in the UI both read this — never reimplement
 * the priority order elsewhere.
 */
export function resolveWasteFate(
  eol: MaterialEol | undefined,
  technology: MaterialTechnology,
  contaminated: boolean,
): { fate: WasteFate; fateReason: string } {
  if (contaminated) {
    return { fate: 'landfill', fateReason: 'Multi-material stream cannot re-enter a single-material loop.' };
  }
  if (!eol) {
    return { fate: 'landfill', fateReason: 'No end-of-life data for this material — assume landfill until verified.' };
  }
  if (eol.fgfDirectReuse && technology === 'fgf') {
    return { fate: 'fgf-direct', fateReason: 'Single-material pellet stream: shredded scrap feeds straight back, no repelletizing.' };
  }
  if (eol.recyclable) {
    return { fate: 'recyclable', fateReason: 'Mechanically recyclable — collect scrap for regrind.' };
  }
  if (eol.compostable) {
    return { fate: 'compostable', fateReason: 'Industrially compostable — route scrap to compost, not landfill.' };
  }
  return { fate: 'landfill', fateReason: 'Not recyclable or compostable per material data — landfill.' };
}

export function computeLoopMetrics(input: {
  meshVolumeMm3: number;
  surfaceAreaMm2: number;
  minWallThicknessMm: number | null;
  thinWallRatio: number;
  overhangRatio: number;
  supportDifficulty: SupportDifficulty;
  /** Authoritative grams from the support module — never recomputed here (single writer). */
  supportGrams: number;
  materialCostUsd: number;
  machineCostUsd: number;
  material: Material;
  technology: MaterialTechnology;
  contaminated: boolean;
}): LoopResult {
  const {
    meshVolumeMm3, surfaceAreaMm2, minWallThicknessMm, thinWallRatio,
    overhangRatio, supportDifficulty, supportGrams,
    materialCostUsd, machineCostUsd, material, technology, contaminated,
  } = input;

  // ── First-time-right ──────────────────────────────────────────────────
  const supportPenalty = SUPPORT_PENALTY[supportDifficulty] ?? 0;
  const overhangPenalty = Math.min(20, overhangRatio * 30);
  const thinPenalty = Math.min(20, thinWallRatio * 25);
  const score = Math.max(0, Math.min(100,
    Math.round(100 - supportPenalty - overhangPenalty - thinPenalty)));

  const drivers: Array<{ penalty: number; label: string }> = [];
  if (supportPenalty > 0) drivers.push({ penalty: supportPenalty, label: `support difficulty: ${supportDifficulty} (−${supportPenalty})` });
  if (overhangPenalty >= 0.5) drivers.push({ penalty: overhangPenalty, label: `overhang ${(overhangRatio * 100).toFixed(1)}% of area (−${overhangPenalty.toFixed(0)})` });
  if (thinPenalty >= 0.5) drivers.push({ penalty: thinPenalty, label: `thin walls ${(thinWallRatio * 100).toFixed(1)}% of samples (−${thinPenalty.toFixed(0)})` });
  drivers.sort((a, b) => b.penalty - a.penalty);
  if (drivers.length === 0) drivers.push({ penalty: 0, label: 'No major printability risks for this geometry.' });

  const expectedFailureCostUsd = Math.round((1 - score / 100) * (materialCostUsd + machineCostUsd) * 100) / 100;

  // ── Waste fate ────────────────────────────────────────────────────────
  // Same unit convention as SustainabilityCard: everything in kg.
  const partKg = (meshVolumeMm3 / 1000) * material.densityGPerCm3 / 1000;
  const supportKg = supportGrams / 1000;
  const lossKg = partKg * 0.1;
  const totalKg = supportKg + lossKg;
  const toGrams = (kg: number): number => Math.round(kg * 1000 * 10) / 10;
  const wasteRatio = partKg > 0 ? totalKg / partKg : 0;

  const eol = material.eol;
  const { fate, fateReason } = resolveWasteFate(eol, technology, contaminated);

  // ── Natural end ───────────────────────────────────────────────────────
  // Thin walls and high surface/volume break down faster (more access for
  // water and microbes) — the "rate varies by shape" vendors print in
  // footnotes, computed from the actual geometry.
  let geometryFactor = 1;
  if (minWallThicknessMm != null && minWallThicknessMm < 1.0) geometryFactor *= 0.75;
  if (meshVolumeMm3 > 0 && surfaceAreaMm2 / meshVolumeMm3 > 1.5) geometryFactor *= 0.9;
  geometryFactor = Math.max(0.5, Math.round(geometryFactor * 100) / 100);

  const range = eol?.compostMonthsRange ?? null;
  const adjust = (m: number): number => Math.max(1, Math.round(m * geometryFactor));
  const monthsCompost: [number, number] | null =
    range == null ? null : [adjust(range[0]), adjust(range[1])];
  const basisNote = range == null
    ? 'No end-of-life data for this material. Breakdown time unknown — verify per grade.'
    : `${eol?.basis ?? 'Material-class baseline.'} Geometry-adjusted ×${geometryFactor} from a ~3mm-wall reference part. Actual rate depends on environment.`;

  return {
    firstTime: {
      score,
      expectedFailureCostUsd,
      drivers: drivers.slice(0, 3).map((d) => d.label),
    },
    waste: {
      partGrams: toGrams(partKg),
      supportGrams: Math.round(supportGrams * 10) / 10,
      processLossGrams: toGrams(lossKg),
      totalWasteGrams: toGrams(totalKg),
      wasteRatio: Math.round(wasteRatio * 1000) / 1000,
      fate,
      fateReason,
      contaminated,
    },
    eol: {
      monthsCompost,
      marineDegradable: eol?.marineDegradable ?? false,
      geometryFactor,
      basisNote,
    },
  };
}
