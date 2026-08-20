// client/src/analysis/concrete.ts
//
// Concrete (construction-scale extrusion) printability metrics.
//
// HONESTY NOTE: like the other application modules, these are geometric
// proxies, not structural/thermo simulation of wet concrete. The real
// drivers of a failed concrete pour are rheology, pump pressure, curing and
// rebar layout — none of which an STL reveals. What we CAN flag from the
// geometry are the conditions that routinely fail:
//
//   - Feature resolution: a ~20mm nozzle cannot print cleanly through
//     features thinner than ~2× nozzle diameter.
//   - Overhang sag: wet concrete is viscous; unsupported overhangs beyond a
//     shallow angle sag and slump under their own weight.
//   - Drying cracks: large flat pours lose water fast at the surface and
//     crack; high surface-area-per-volume on big parts is the warning sign.
//
// Print time is estimated from volume (concrete lays down fast, but parts
// are big) — also a proxy, not a job quote.

import type { UnifiedAnalysis } from './types';

/** Typical construction-extrusion nozzle diameter. */
export const CONCRETE_NOZZLE_MM = 20;
/** Rough hours of print per cubic metre. */
const HOURS_PER_M3 = 4;

export interface ConcreteResult {
  /** 0..1 — features thinner than ~2× nozzle can't print cleanly. */
  featureResolutionRisk: number;
  /** 0..1 — unsupported overhangs sag (wet concrete). */
  overhangSagRisk: number;
  /** 0..1 — large flat pours risk drying/curing cracks. */
  crackRisk: number;
  /** Estimated print time at construction scale (hours). */
  printTimeHours: number;
  /** Human-readable top concerns. */
  concerns: string[];
}

export function computeConcreteMetrics(input: {
  minWallThicknessMm: number | null;
  overhangRatio: number;
  surfaceAreaMm2: number;
  volumeMm3: number;
}): ConcreteResult {
  const { minWallThicknessMm, overhangRatio, surfaceAreaMm2, volumeMm3 } = input;

  // Features below ~2× nozzle diameter under-resolve.
  const featureResolutionRisk = minWallThicknessMm != null
    ? Math.min(1, Math.max(0, (2 * CONCRETE_NOZZLE_MM - minWallThicknessMm) / (2 * CONCRETE_NOZZLE_MM)))
    : 0.3;

  const overhangSagRisk = Math.min(1, overhangRatio);

  // Surface-area-per-volume on a big pour → drying cracks. Concrete is wet at
  // the surface, so high SA/V dries/cracks faster.
  const saVol = volumeMm3 > 0 ? surfaceAreaMm2 / volumeMm3 : 0;
  const crackRisk = Math.min(1, Math.max(0, (saVol - 0.1) / 1.0));

  const volumeM3 = volumeMm3 / 1e9;
  const printTimeHours = Math.max(0.5, Math.round(volumeM3 * HOURS_PER_M3 * 10) / 10);

  const concerns: string[] = [];
  if (featureResolutionRisk > 0.5) concerns.push('⚠ features finer than the ~20mm nozzle — cannot print cleanly');
  if (overhangSagRisk > 0.4) concerns.push('⚠ overhangs will sag — wet concrete needs support below ~35°');
  if (crackRisk > 0.5) concerns.push('⚠ large flat pours risk drying/curing cracks');
  if (concerns.length === 0) concerns.push('Part looks printable at construction scale.');

  return { featureResolutionRisk, overhangSagRisk, crackRisk, printTimeHours, concerns };
}

/** Build the concrete metrics straight from a UnifiedAnalysis. */
export function concreteFromUnified(unified: UnifiedAnalysis): ConcreteResult | null {
  const m = unified.metrics?.result;
  if (!m || m.meshVolumeMm3 <= 0) return null;
  return computeConcreteMetrics({
    minWallThicknessMm: m.minWallThicknessMm,
    overhangRatio: m.overhang?.ratio ?? 0,
    surfaceAreaMm2: m.surfaceAreaMm2,
    volumeMm3: m.meshVolumeMm3,
  });
}
