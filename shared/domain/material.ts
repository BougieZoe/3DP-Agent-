/**
 * Material — printability domain concept.
 *
 * Lives in shared/domain (not client/src/lib) because it is consumed by the
 * analysis layer, the agent system, and the UI alike. Keeping it in lib/
 * forced analysis→lib and agents→lib edges, violating the layer boundary:
 * domain code must not depend on UI-adjacent code. Moved here per the
 * architecture review (P1-3: "Move Material + materialState into
 * shared/domain; delete the analysis→lib and agents→lib edges").
 */

export type MaterialTechnology = 'fdm' | 'sla' | 'fgf';

export interface Material {
  name: string;
  /** Which printer technology this material feeds (FDM filament, SLA resin, FGF pellet). */
  technology: MaterialTechnology;
  overhangThreshold: number;
  densityGPerCm3: number;
  pricePerKgUsd: number;
}

export const MATERIALS: Record<string, Material> = {
  // FDM — filaments
  PLA:  { name: 'PLA',  technology: 'fdm', overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 22 },
  PETG: { name: 'PETG', technology: 'fdm', overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 25 },
  ABS:  { name: 'ABS',  technology: 'fdm', overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 28 },
  TPU:  { name: 'TPU',  technology: 'fdm', overhangThreshold: 40, densityGPerCm3: 1.21, pricePerKgUsd: 45 },
  ASA:  { name: 'ASA',  technology: 'fdm', overhangThreshold: 45, densityGPerCm3: 1.07, pricePerKgUsd: 30 },
  PC:   { name: 'PC',   technology: 'fdm', overhangThreshold: 35, densityGPerCm3: 1.20, pricePerKgUsd: 40 },
  NYLON:{ name: 'Nylon',technology: 'fdm', overhangThreshold: 40, densityGPerCm3: 1.14, pricePerKgUsd: 45 },
  // SLA/DLP — resins (a material family for the SLA/DLP printer technology)
  RESIN_STD: { name: 'Standard Resin', technology: 'sla', overhangThreshold: 40, densityGPerCm3: 1.15, pricePerKgUsd: 60 },
  RESIN_TOUGH: { name: 'Tough Resin',   technology: 'sla', overhangThreshold: 40, densityGPerCm3: 1.17, pricePerKgUsd: 90 },
  RESIN_CLEAR: { name: 'Clear Resin',   technology: 'sla', overhangThreshold: 40, densityGPerCm3: 1.14, pricePerKgUsd: 75 },
  RESIN_ENG:  { name: 'Engineering Resin', technology: 'sla', overhangThreshold: 40, densityGPerCm3: 1.18, pricePerKgUsd: 120 },
  RESIN_DENTAL: { name: 'Dental Resin', technology: 'sla', overhangThreshold: 40, densityGPerCm3: 1.20, pricePerKgUsd: 200 },
  // FGF — pellet feedstocks
  ABS_PELLET: { name: 'ABS Pellet', technology: 'fgf', overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 8 },
  PETG_PELLET: { name: 'PETG Pellet', technology: 'fgf', overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 9 },
  PP_PELLET:  { name: 'PP Pellet',  technology: 'fgf', overhangThreshold: 45, densityGPerCm3: 0.91, pricePerKgUsd: 10 },
};

export const DEFAULT_MATERIAL = MATERIALS.PLA;

/** Materials available for a given printer technology (FDM → filaments, SLA → resins, FGF → pellets). */
export function materialsForTechnology(tech: MaterialTechnology): Material[] {
  return Object.values(MATERIALS).filter(m => m.technology === tech);
}

/** First/default material for a technology (used when switching printer types). */
export function defaultMaterialFor(tech: MaterialTechnology): Material {
  const list = materialsForTechnology(tech);
  return list[0] ?? DEFAULT_MATERIAL;
}

export function getDensityGPerMm3(m: Material): number {
  return m.densityGPerCm3 / 1000;
}
