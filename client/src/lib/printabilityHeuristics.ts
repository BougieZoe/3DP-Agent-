import type { LegacyPrintabilityStatus } from '@shared/domain/printability';

export interface WallThicknessHeuristicResult {
  minThickness: number;
  areas: number;
  status: LegacyPrintabilityStatus;
}

export interface OverhangHeuristicResult {
  angle: number;
  areas: number;
  status: LegacyPrintabilityStatus;
}

export function evaluateWallThicknessHeuristic(
  size: { x: number; y: number; z: number },
  vertexCount: number,
): WallThicknessHeuristicResult {
  const minThickness = Math.min(size.x, size.y, size.z) * 0.5;
  const status = minThickness < 1 ? 'critical' : minThickness < 2 ? 'warning' : 'good';

  return {
    minThickness,
    areas: Math.floor(vertexCount * 0.15),
    status,
  };
}

export function evaluateOverhangHeuristic(
  normals: Float32Array,
  positionsLength: number,
): OverhangHeuristicResult {
  let overhangCount = 0;

  for (let i = 0; i < normals.length; i += 3) {
    const ny = normals[i + 1];
    const angle = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);

    if (angle > 45) {
      overhangCount++;
    }
  }

  return {
    angle: 45,
    areas: overhangCount,
    status: overhangCount > positionsLength * 0.1 ? 'warning' : 'good',
  };
}
