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

export interface Material {
  name: string;
  overhangThreshold: number;
  densityGPerCm3: number;
  pricePerKgUsd: number;
}

export const MATERIALS: Record<string, Material> = {
  PLA:  { name: 'PLA',  overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 22 },
  PETG: { name: 'PETG', overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 25 },
  ABS:  { name: 'ABS',  overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 28 },
};

export const DEFAULT_MATERIAL = MATERIALS.PLA;

export function getDensityGPerMm3(m: Material): number {
  return m.densityGPerCm3 / 1000;
}
