// client/src/analysis/eco.ts
//
// Eco-material advisory module — recycled / bio-sourced / low-impact
// thermoplastics. Unlike the geometry-heavy families, this is largely a
// MATERIAL-KNOWLEDGE layer: the risks come from how the material degrades,
// not from the part's shape. The one geometry input we use is the thin-wall
// ratio, which makes a brittle material's weakness concrete.

export interface EcoResult {
  /** 0..1 — material absorbs moisture → dry before printing. */
  moistureRisk: number;
  /** 0..1 — material degrades in heat/UV → storage + service limits. */
  degradationRisk: number;
  /** 0..1 — material is brittle, worse where walls are thin. */
  brittlenessRisk: number;
  /** Human-readable advisory. */
  concerns: string[];
}

export function computeEcoMetrics(input: {
  moistureRisk: number;
  degradationRisk: number;
  brittlenessRisk: number;
  thinWallRatio: number;
}): EcoResult {
  const { moistureRisk, degradationRisk, brittlenessRisk, thinWallRatio } = input;

  // Thin walls amplify a brittle material's weakness: a wall at half the
  // healthy thickness roughly doubles the crack likelihood.
  const brittleness = Math.min(1, brittlenessRisk + thinWallRatio * 2);

  const concerns: string[] = [];
  if (moistureRisk > 0.4) concerns.push('⚠ hygroscopic — dry the filament before printing');
  if (degradationRisk > 0.5) concerns.push('⚠ degrades in heat/UV — check storage and service temperature');
  if (brittleness > 0.6) concerns.push('⚠ brittle material — thin walls will crack under load');
  if (concerns.length === 0) concerns.push('Eco-material advisory — no major red flags for this geometry.');

  return { moistureRisk, degradationRisk, brittlenessRisk: brittleness, concerns };
}
