import { moduleResult, type AnalysisModuleResult, type Confidence, type SupportResult, type SupportDifficulty } from './types';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

const OVERHANG_THRESHOLD_DEG = 45;
const PLA_DENSITY_G_PER_MM3 = 0.00124;

export function estimateSupportVolume(
  model: GeometryModel,
  graph?: GeometryGraph | null,
): AnalysisModuleResult<SupportResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g || g.indices.length === 0) {
    return moduleResult('support', 0.0, 0, {
      totalSupportVolumeMm3: 0, supportFaceCount: 0,
      averageOverhangAngleDeg: 0, difficulty: 'none',
      estimatedSupportGrams: 0, volumeByAngleDeg: [],
    }, 'Cannot estimate supports: need indexed geometry');
  }

  const positions = g.positions;
  const indices = g.indices;
  const faceCount = g.triangleCount;
  const bbox = g.boundingBox;
  const minY = bbox.minY;

  let totalSupportVolume = 0;
  let totalOverhangAngle = 0;
  let supportFaceCount = 0;
  let supportFaceArea = 0;

  const volumeByAngle = new Map<string, { volumeMm3: number; faceCount: number }>();
  const angleBuckets = [
    { label: '45-60°', min: 45, max: 60, ratio: 0.3 },
    { label: '60-75°', min: 60, max: 75, ratio: 0.5 },
    { label: '75-90°', min: 75, max: 90, ratio: 0.8 },
  ];

  for (const bucket of angleBuckets) {
    volumeByAngle.set(bucket.label, { volumeMm3: 0, faceCount: 0 });
  }

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
    if (len < 1e-12) continue;

    const cosAngle = Math.abs(ny) / len;
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);

    if (angleDeg <= OVERHANG_THRESHOLD_DEG) continue;

    const area = len / 2;
    const fcy = (ay + by + cy) / 3;
    const height = fcy - minY;

    let bucketRatio = 0.3;
    let bucketLabel = '45-60°';
    for (const bucket of angleBuckets) {
      if (angleDeg >= bucket.min && angleDeg < bucket.max) {
        bucketRatio = bucket.ratio;
        bucketLabel = bucket.label;
        break;
      }
    }

    const supportVol = area * Math.max(0.5, height) * bucketRatio;

    totalSupportVolume += supportVol;
    totalOverhangAngle += angleDeg;
    supportFaceCount++;
    supportFaceArea += area;

    const bucketData = volumeByAngle.get(bucketLabel);
    if (bucketData) {
      bucketData.volumeMm3 += supportVol;
      bucketData.faceCount++;
    }
  }

  const avgAngle = supportFaceCount > 0 ? totalOverhangAngle / supportFaceCount : 0;
  const supportGrams = totalSupportVolume / 1000 * PLA_DENSITY_G_PER_MM3;

  let difficulty: SupportDifficulty = 'none';
  if (supportFaceCount > 0) {
    const supportRatio = faceCount > 0 ? supportFaceCount / faceCount : 0;
    if (supportRatio > 0.3 || totalSupportVolume > 50000) difficulty = 'very_difficult';
    else if (supportRatio > 0.15 || totalSupportVolume > 20000) difficulty = 'difficult';
    else if (supportRatio > 0.05 || totalSupportVolume > 5000) difficulty = 'moderate';
    else difficulty = 'easy';
  }

  const volumeByAngleDeg = Array.from(volumeByAngle.entries())
    .filter(([, data]) => data.faceCount > 0)
    .map(([range, data]) => ({ range, volumeMm3: data.volumeMm3, faceCount: data.faceCount }));

  const confidence: Confidence = supportFaceCount > 10 ? 0.6 as Confidence : supportFaceCount > 0 ? 0.4 as Confidence : 0.9 as Confidence;

  const result: SupportResult = {
    totalSupportVolumeMm3: totalSupportVolume,
    supportFaceCount,
    averageOverhangAngleDeg: avgAngle,
    difficulty,
    estimatedSupportGrams: supportGrams,
    volumeByAngleDeg,
  };

  const parts: string[] = [];
  if (supportFaceCount === 0) {
    parts.push('No supports needed');
  } else {
    parts.push(`Estimated support volume: ${totalSupportVolume.toFixed(0)} mm³ (${supportGrams.toFixed(1)}g)`);
    parts.push(`Difficulty: ${difficulty}`);
    parts.push(`${supportFaceCount} overhang faces with average angle ${avgAngle.toFixed(1)}°`);
  }

  return moduleResult('support', confidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}
