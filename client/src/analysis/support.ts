import { moduleResult, type AnalysisModuleResult, type Confidence, type SupportRegion, type SupportResult, type SupportDifficulty } from './types';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';
import { getThresholds, type AnalysisThresholds } from './thresholds';
import { overhangTiltBelowHorizontalDeg, isOnBuildPlate } from './metrics';

export function estimateSupportVolume(
  model: GeometryModel,
  graph?: GeometryGraph | null,
  overhangThresholdDeg?: number,
  densityGPerMm3?: number,
  language: ContentLang = 'en',
  thresholds: AnalysisThresholds = getThresholds(),
): AnalysisModuleResult<SupportResult> {
  const supportConfig = thresholds.support;
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g || g.indices.length === 0) {
    return moduleResult('support', 0.0, 0, {
      totalSupportVolumeMm3: 0, supportFaceCount: 0,
      averageOverhangAngleDeg: 0, difficulty: 'none',
      estimatedSupportGrams: 0, volumeByAngleDeg: [],
      supportRegions: [], largestRegionRatio: 0,
      tallSupportRatio: 0, zGradient: 0, directionality: 0,
    }, translate(CONTENT, 'support.noIndexedGeometry', language));
  }

  const positions = g.positions;
  const indices = g.indices;
  const faceCount = g.triangleCount;
  const bbox = g.boundingBox;
  // Build axis is Z (slicer convention): supports grow upward from the bed at
  // the model's lowest Z, and only downward-facing surfaces need them.
  const minZ = bbox.minZ;
  const modelHeight = Math.max(1e-6, bbox.maxZ - bbox.minZ);

  let totalSupportVolume = 0;
  let totalOverhangAngle = 0;
  let supportFaceCount = 0;
  let supportFaceArea = 0;

  const supportFaceIndices: number[] = [];
  const supportFaceVolumes: number[] = [];
  const supportFaceAngles: number[] = [];

  const volumeByAngle = new Map<string, { volumeMm3: number; faceCount: number }>();
  const angleBuckets = supportConfig.angleBuckets;

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

    // Z-up overhang test shared with the metrics module (sign-aware, downward only).
    const tiltDeg = overhangTiltBelowHorizontalDeg(nz, len);
    if (tiltDeg === null) continue;

    const fcz = (az + bz + cz) / 3;
    const height = fcz - minZ;

    // Faces resting on the build plate are supported by the bed, not by supports.
    if (isOnBuildPlate(fcz, minZ, modelHeight)) continue;

    if (tiltDeg <= (overhangThresholdDeg ?? thresholds.overhangThresholdDeg)) continue;

    const area = len / 2;

    const defaultBucket = angleBuckets[0];
    let bucketRatio = defaultBucket?.ratio ?? 0.3;
    let bucketLabel = defaultBucket?.label ?? '45-60°';
    for (const bucket of angleBuckets) {
      if (tiltDeg >= bucket.min && tiltDeg < bucket.max) {
        bucketRatio = bucket.ratio;
        bucketLabel = bucket.label;
        break;
      }
    }

    const supportVol = area * Math.max(supportConfig.minHeightMm, height) * bucketRatio;

    totalSupportVolume += supportVol;
    totalOverhangAngle += tiltDeg;
    supportFaceCount++;
    supportFaceArea += area;

    const triIdx = i / 3;
    supportFaceIndices.push(triIdx);
    supportFaceVolumes.push(supportVol);
    supportFaceAngles.push(tiltDeg);

    const bucketData = volumeByAngle.get(bucketLabel);
    if (bucketData) {
      bucketData.volumeMm3 += supportVol;
      bucketData.faceCount++;
    }
  }

  const avgAngle = supportFaceCount > 0 ? totalOverhangAngle / supportFaceCount : 0;
  const supportGrams = totalSupportVolume / 1000 * (densityGPerMm3 ?? supportConfig.densityGPerMm3);

  let difficulty: SupportDifficulty = 'none';
  if (supportFaceCount > 0) {
    const supportRatio = faceCount > 0 ? supportFaceCount / faceCount : 0;
    const diff = supportConfig.difficulty;
    if (supportRatio > diff.veryDifficultFaceRatio || totalSupportVolume > diff.veryDifficultVolumeMm3) difficulty = 'very_difficult';
    else if (supportRatio > diff.difficultFaceRatio || totalSupportVolume > diff.difficultVolumeMm3) difficulty = 'difficult';
    else if (supportRatio > diff.moderateFaceRatio || totalSupportVolume > diff.moderateVolumeMm3) difficulty = 'moderate';
    else difficulty = 'easy';
  }

  // ─── BFS clustering of support faces ─────────────────────────────────────────
  const regions: SupportRegion[] = [];
  if (supportFaceCount > 0 && g.faceNeighbors.length > 0) {
    const supportSet = new Set(supportFaceIndices);
    const visited = new Set<number>();

    for (const faceIdx of supportFaceIndices) {
      if (visited.has(faceIdx)) continue;

      const cluster: number[] = [];
      const queue: number[] = [faceIdx];
      visited.add(faceIdx);

      while (queue.length > 0) {
        const cur = queue.shift()!;
        cluster.push(cur);
        const start = g.faceNeighborStart[cur];
        const end = g.faceNeighborStart[cur + 1];
        for (let k = start; k < end; k++) {
          const nb = g.faceNeighbors[k];
          if (!visited.has(nb) && supportSet.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }

      // Compute region stats from cluster face indices
      let sumCx = 0, sumCy = 0, sumCz = 0;
      let minRx = Infinity, maxRx = -Infinity;
      let minRy = Infinity, maxRy = -Infinity;
      let minRz = Infinity, maxRz = -Infinity;
      let sumUnX = 0, sumUnY = 0, sumUnZ = 0;
      let sumAngle = 0;
      let sumVol = 0;

      for (const fi of cluster) {
        const c3 = fi * 3;
        const cx = g.faceCentroids[c3], cy = g.faceCentroids[c3 + 1], cz = g.faceCentroids[c3 + 2];
        sumCx += cx; sumCy += cy; sumCz += cz;
        if (cx < minRx) minRx = cx;
        if (cx > maxRx) maxRx = cx;
        if (cy < minRy) minRy = cy;
        if (cy > maxRy) maxRy = cy;
        if (cz < minRz) minRz = cz;
        if (cz > maxRz) maxRz = cz;

        const f4 = fi * 4;
        const fnLen = g.faceNormals[f4 + 3];
        const invLen = fnLen > 1e-12 ? 1 / fnLen : 0;
        sumUnX += g.faceNormals[f4] * invLen;
        sumUnY += g.faceNormals[f4 + 1] * invLen;
        sumUnZ += g.faceNormals[f4 + 2] * invLen;
      }

      // Map cluster -> supportFaceIndices to retrieve volume/angle
      const clusterSet = new Set(cluster);
      for (let k = 0; k < supportFaceIndices.length; k++) {
        if (clusterSet.has(supportFaceIndices[k])) {
          sumAngle += supportFaceAngles[k];
          sumVol += supportFaceVolumes[k];
        }
      }

      const fc = cluster.length;
      const normMag = Math.sqrt(sumUnX * sumUnX + sumUnY * sumUnY + sumUnZ * sumUnZ);

      regions.push({
        faceCount: fc,
        centroid: { x: sumCx / fc, y: sumCy / fc, z: sumCz / fc },
        boundingBoxSize: { x: maxRx - minRx, y: maxRy - minRy, z: maxRz - minRz },
        normalizedDirection: normMag > 1e-12
          ? { x: sumUnX / normMag, y: sumUnY / normMag, z: sumUnZ / normMag }
          : { x: 0, y: 0, z: 0 },
        avgAngleDeg: fc > 0 ? sumAngle / fc : 0,
        estimatedVolumeMm3: sumVol,
        zRange: { min: minRz, max: maxRz },
      });
    }

    regions.sort((a, b) => b.faceCount - a.faceCount);
  }

  // ─── Aggregate metrics ───────────────────────────────────────────────────────
  const largestRegionRatio = supportFaceCount > 0 && regions.length > 0
    ? regions[0].faceCount / supportFaceCount
    : 0;

  // Z gradient: weighted mean Z of support faces vs model midpoint
  let tallSupportCount = 0;
  let weightedZSum = 0;
  const zMid = (bbox.maxZ + bbox.minZ) / 2;
  const zRange = Math.max(bbox.maxZ - bbox.minZ, 1);

  for (let k = 0; k < supportFaceIndices.length; k++) {
    const fi = supportFaceIndices[k];
    const cz = g.faceCentroids[fi * 3 + 2];
    const relZ = (cz - bbox.minZ) / zRange;  // 0–1 from bottom to top
    weightedZSum += relZ;
    if (cz > zMid) tallSupportCount++;
  }

  const tallSupportRatio = supportFaceCount > 0 ? tallSupportCount / supportFaceCount : 0;
  const meanRelZ = supportFaceCount > 0 ? weightedZSum / supportFaceCount : 0.5;
  const zGradient = Math.max(-1, Math.min(1, (meanRelZ - 0.5) * 4));

  // Directionality: magnitude of summed unit normals / count
  let sumDirX = 0, sumDirY = 0, sumDirZ = 0;
  for (const fi of supportFaceIndices) {
    const f4 = fi * 4;
    const fnLen = g.faceNormals[f4 + 3];
    const invLen = fnLen > 1e-12 ? 1 / fnLen : 0;
    sumDirX += g.faceNormals[f4] * invLen;
    sumDirY += g.faceNormals[f4 + 1] * invLen;
    sumDirZ += g.faceNormals[f4 + 2] * invLen;
  }
  const dirMag = Math.sqrt(sumDirX * sumDirX + sumDirY * sumDirY + sumDirZ * sumDirZ);
  const directionality = supportFaceCount > 0 ? dirMag / supportFaceCount : 0;

  const volumeByAngleDeg = Array.from(volumeByAngle.entries())
    .filter(([, data]) => data.faceCount > 0)
    .map(([range, data]) => ({ range, volumeMm3: data.volumeMm3, faceCount: data.faceCount }));

  const conf = supportConfig.confidence;
  const confidence: Confidence = supportFaceCount > conf.highConfidenceFaceCount ? conf.highConfidence as Confidence : supportFaceCount > conf.lowConfidenceFaceCount ? conf.lowConfidence as Confidence : conf.noneConfidence as Confidence;

  const result: SupportResult = {
    totalSupportVolumeMm3: totalSupportVolume,
    supportFaceCount,
    averageOverhangAngleDeg: avgAngle,
    difficulty,
    estimatedSupportGrams: supportGrams,
    volumeByAngleDeg,
    supportRegions: regions,
    largestRegionRatio,
    tallSupportRatio,
    zGradient,
    directionality,
  };

  const parts: string[] = [];
  if (supportFaceCount === 0) {
    parts.push(translate(CONTENT, 'support.none', language));
  } else {
    parts.push(translate(CONTENT, 'support.volume', language, {
      volume: totalSupportVolume.toFixed(0),
      grams: supportGrams.toFixed(1),
    }));
    parts.push(translate(CONTENT, 'support.difficultyLabel', language, { difficulty }));
    parts.push(translate(CONTENT, 'support.overhangFaces', language, { count: supportFaceCount, angle: avgAngle.toFixed(1) }));
  }

  return moduleResult('support', confidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}
