import { type OverhangMetrics } from './types';

const OVERHANG_ANGLE_BUCKETS = [
  { minAngle: 0, maxAngle: 30 },
  { minAngle: 30, maxAngle: 45 },
  { minAngle: 45, maxAngle: 60 },
  { minAngle: 60, maxAngle: 75 },
  { minAngle: 75, maxAngle: 90 },
];

function classifyOverhangSeverity(ratio: number): OverhangMetrics['severity'] {
  if (ratio > 0.5) return 'severe';
  if (ratio > 0.3) return 'moderate';
  return 'none';
}

export function deriveOhStatus(ratio: number): 'good' | 'warning' | 'critical' {
  if (ratio > 0.15) return 'critical';
  if (ratio > 0.05) return 'warning';
  return 'good';
}

export function analyzeOverhang(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  overhangThresholdDeg: number = 50,
): OverhangMetrics {
  const triCount = Math.floor(indices.length / 3);
  const thresholdRad = (overhangThresholdDeg * Math.PI) / 180;

  let overhangFaceCount = 0;
  const breakdown: { minAngle: number; maxAngle: number; faceCount: number }[] = [];

  for (const { minAngle, maxAngle } of OVERHANG_ANGLE_BUCKETS) {
    breakdown.push({ minAngle, maxAngle, faceCount: 0 });
  }

  const up = { x: 0, y: 0, z: 1 };

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len === 0) continue;

    const dot = (nx * up.x + ny * up.y + nz * up.z) / len;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDeg = (angle * 180) / Math.PI;

    for (let b = 0; b < OVERHANG_ANGLE_BUCKETS.length; b++) {
      const { minAngle, maxAngle } = OVERHANG_ANGLE_BUCKETS[b];
      if (angleDeg >= minAngle && angleDeg <= maxAngle) {
        breakdown[b].faceCount++;
        break;
      }
    }

    if (angle < thresholdRad) {
      overhangFaceCount++;
    }
  }

  const ratio = triCount > 0 ? overhangFaceCount / triCount : 0;
  const severity = classifyOverhangSeverity(ratio);

  return {
    faceCount: overhangFaceCount,
    totalFaceCount: triCount,
    ratio,
    severity,
    breakdownByAngleDeg: breakdown,
  };
}
