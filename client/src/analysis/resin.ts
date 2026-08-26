import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import type { GeometryModel } from './geometryModel';

// ─────────────────────────────────────────────────────────────────────────────
// Resin (LCD/DLP/SLA) printability metrics — deterministic geometric signals.
// Resin printing fails differently from FDM: suction/peel forces on large flat
// cross-sections, floating islands that shear off, and enclosed cavities that
// trap uncured resin (need drain holes). These metrics feed the scoring + the
// resin expert LLM agent.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResinResult {
  /** Number of spatially-disconnected surface shells (1 = simple exterior, >1 = internal cavities / separate parts). */
  shellCount: number;
  /** True when more than one shell exists → separate parts or an enclosed cavity needing drain holes. */
  enclosedCavity: boolean;
  /** Count of disconnected regions not touching the build plate (float/fall risk). */
  islandCount: number;
  /** Peel/suction risk 0..1 from large horizontal cross-sections. */
  suctionRisk: number;
  /** Over-cure risk 0..1 (thin, high-surface-area regions). */
  cureRisk: number;
  /** Heuristic print orientation advice. */
  orientation: 'default' | 'tilt' | 'reorient';
  /** Projected build-plate footprint area (mm²). */
  footprintAreaMm2: number;
}

export function computeResinMetrics(
  model: GeometryModel,
  graph?: GeometryGraph | null,
): ResinResult {
  const { positions, indices, triangleCount, vertexCount } = model;
  const triCount = triangleCount;
  const g = graph ?? buildGeometryGraph(model);

  // Global min/max Z
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const z = positions[v * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const height = Math.max(1e-6, maxZ - minZ);
  const eps = Math.max(1e-4, height * 0.002); // "touches the plate" tolerance

  // Spatially-connected components via the geometry graph's face adjacency.
  const visited = new Uint8Array(triCount);
  const components: number[][] = [];
  if (g && g.faceNeighbors.length > 0) {
    for (let t = 0; t < triCount; t++) {
      if (visited[t]) continue;
      visited[t] = 1;
      const stack = [t];
      const comp: number[] = [];
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        const start = g.faceNeighborStart[cur];
        const end = g.faceNeighborStart[cur + 1];
        for (let k = start; k < end; k++) {
          const nb = g.faceNeighbors[k];
          if (!visited[nb]) { visited[nb] = 1; stack.push(nb); }
        }
      }
      components.push(comp);
    }
  } else {
    components.push(Array.from({ length: triCount }, (_, i) => i));
  }

  // Per-component min-Z + face geometry pass
  let islandCount = 0;
  let upwardArea = 0;
  let surfaceArea = 0;
  let footprintArea = 0;

  for (const comp of components) {
    let compMinZ = Infinity;
    for (const t of comp) {
      for (let k = 0; k < 3; k++) {
        const vi = indices[t * 3 + k];
        compMinZ = Math.min(compMinZ, positions[vi * 3 + 2]);
      }
    }
    if (compMinZ - minZ > eps) islandCount++;

    for (const t of comp) {
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
      surfaceArea += area;
      const nzNorm = nz / len;
      // upward-facing near-horizontal faces → suction/peel surface
      if (nzNorm > 0.7) upwardArea += area;
      footprintArea += area * Math.abs(nzNorm);
    }
  }

  // Normalize suction risk against a reference footprint (a 40×40mm flat top)
  const REF = 1600; // mm²
  const suctionRisk = Math.min(1, upwardArea / REF);

  // Over-cure risk: thin structures → high surface area per unit footprint height
  const referenceVolume = footprintArea * height;
  const slenderness = referenceVolume > 1e-6 ? surfaceArea / referenceVolume : 0;
  const cureRisk = Math.min(1, slenderness / 20);

  const orientation: ResinResult['orientation'] =
    islandCount > 0 || suctionRisk > 0.6 ? 'reorient' : suctionRisk > 0.35 ? 'tilt' : 'default';

  return {
    shellCount: components.length,
    enclosedCavity: components.length > 1,
    islandCount,
    suctionRisk,
    cureRisk,
    orientation,
    footprintAreaMm2: Math.round(footprintArea * 100) / 100,
  };
}
