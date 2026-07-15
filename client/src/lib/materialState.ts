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
