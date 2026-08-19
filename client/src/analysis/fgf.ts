import { buildGeometryGraph } from './geometryGraph';
import type { GeometryModel } from './geometryModel';

// ─────────────────────────────────────────────────────────────────────────────
// FGF (Fused Granulate Fabrication / large-format pellet extrusion) metrics.
//
// HONESTY NOTE: real FGF failure modes (thermal warpage at scale, layer
// delamination, long cooling contraction) are governed by THERMAL PHYSICS that
// cannot be computed from STL geometry alone. These are geometric PROXIES —
// defensible signals that correlate with those risks, NOT a thermal simulation.
// Thresholds are heuristics, intentionally labeled as such.
// ─────────────────────────────────────────────────────────────────────────────

export interface FgfResult {
  /** Size band from the part's largest dimension (mm). */
  partScale: 'small' | 'medium' | 'large' | 'very-large';
  /** Largest bounding-box dimension (mm). */
  maxDimMm: number;
  /** Part height (mm). */
  partHeightMm: number;
  /** Build-plate footprint area (mm²). */
  footprintAreaMm2: number;
  /** 0..1 — large horizontal top surfaces on big parts → thermal contraction warpage risk. */
  warpageRisk: number;
  /** 0..1 — large vertical wall surface area → layer delamination risk. */
  delaminationRisk: number;
  /** 0..1 — height vs footprint slenderness (tall slender parts are risky). */
  slenderness: number;
  /** Heuristic print orientation. */
  orientation: 'flat' | 'tilt' | 'upright';
}

export function computeFgfMetrics(model: GeometryModel): FgfResult {
  const { positions, indices, triangleCount, vertexCount } = model;
  const triCount = triangleCount;

  // Bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dimX = Math.max(1e-6, maxX - minX);
  const dimY = Math.max(1e-6, maxY - minY);
  const height = Math.max(1e-6, maxZ - minZ);
  const maxDim = Math.max(dimX, dimY, height);

  // Face pass: upward flat area, vertical wall area, footprint
  let upwardArea = 0;   // near-horizontal top faces (|nz| high)
  let verticalArea = 0; // near-vertical walls (|nz| low)
  let footprintArea = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-9) continue;
    const area = len / 2;
    const nzNorm = nz / len;
    if (nzNorm > 0.8) upwardArea += area;
    if (Math.abs(nzNorm) < 0.2) verticalArea += area;
    footprintArea += area * Math.abs(nzNorm);
  }

  // Size band — heuristic based on typical FGF nozzle/pellet throughput.
  const partScale: FgfResult['partScale'] =
    maxDim < 100 ? 'small' : maxDim < 400 ? 'medium' : maxDim < 1000 ? 'large' : 'very-large';

  // Warpage risk: big parts with large flat horizontal top faces.
  // Large footprints × thin feature spans contract unevenly on cooling.
  const flatFraction = footprintArea > 1e-6 ? upwardArea / footprintArea : 0;
  const scaleFactor = Math.min(1, maxDim / 800); // grows with part size
  const warpageRisk = Math.min(1, flatFraction * scaleFactor * 1.6);

  // Delamination risk: proportion of vertical wall surface; thick FGF layers
  // bond weaker, so a big vertical surface is a delamination surface.
  const surfaceArea = footprintArea + verticalArea + upwardArea;
  const wallFraction = surfaceArea > 1e-6 ? verticalArea / surfaceArea : 0;
  const delaminationRisk = Math.min(1, wallFraction * 1.5);

  // Slenderness: tall parts on a small footprint are unstable/risky.
  const slenderness = Math.min(1, height / Math.sqrt(Math.max(1e-6, footprintArea)) / 6);

  const orientation: FgfResult['orientation'] =
    slenderness > 0.7 ? 'flat' : delaminationRisk > 0.6 ? 'tilt' : 'upright';

  return {
    partScale,
    maxDimMm: Math.round(maxDim * 100) / 100,
    partHeightMm: Math.round(height * 100) / 100,
    footprintAreaMm2: Math.round(footprintArea * 100) / 100,
    warpageRisk,
    delaminationRisk,
    slenderness,
    orientation,
  };
}
