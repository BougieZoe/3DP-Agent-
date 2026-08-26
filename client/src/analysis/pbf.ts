// client/src/analysis/pbf.ts
//
// Powder Bed Fusion (PBF) printability metrics — SLS / SLM(DMLS) / MJF.
//
// HONESTY NOTE: like FGF, these are GEOMETRIC PROXIES, not thermal/FEA
// simulation. We cannot simulate residual stress or sintering physics in the
// browser — we detect the geometric conditions that correlate with real PBF
// failure modes:
//
//   - Powder trap: an enclosed cavity means unsintered powder is trapped
//     inside and cannot escape → needs escape/drain holes. Worse for metal
//     (SLM), where trapped powder is expensive and hard to remove.
//   - Large near-horizontal plates: big flat regions sinter/cool unevenly →
//     warpage / residual stress. This is the closest proxy we have for the
//     thermal-distortion the process genuinely suffers.
//   - Overhang: polymer PBF (SLS/MJF) is self-supporting — powder holds the
//     part, so overhangs are far less critical. Metal PBF (SLM) NEEDS support
//     anchors for any steep unsupported face.
//
// The result carries `selfSupporting` so the caller/UI/LLM interprets the
// same number correctly per process.

import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { analyzeOverhang } from './metrics';
import { getThresholds } from './thresholds';
import type { GeometryModel } from './geometryModel';

export type PbfKind = 'sls' | 'slm' | 'mjf';

export interface PbfResult {
  kind: PbfKind;
  /** Number of disconnected surface shells — >1 means internal cavities or separate parts. */
  shellCount: number;
  /** Enclosed cavity present → powder is trapped inside, needs escape holes. */
  powderTrap: boolean;
  /** Area of the largest single near-horizontal plate (mm²) — the warpage driver. */
  largestFlatPlateMm2: number;
  /** Fraction of total surface that is near-horizontal (proxy for sintering stress). */
  flatPlateRatio: number;
  /** Fraction of surface beyond the overhang threshold (metal support need). */
  overhangRatio: number;
  overhangAreaMm2: number;
  /** 0..1 residual-stress / distortion-risk proxy (geometric, not FEA). */
  distortionRisk: number;
  /** Polymer PBF is powder-supported (true); metal needs explicit supports (false). */
  selfSupporting: boolean;
  /** Projected build footprint area (mm²). */
  footprintAreaMm2: number;
  /** Heuristic orientation advice. */
  orientation: 'upright' | 'tilt' | 'reorient';
}

/** PBF support threshold — metal needs anchors beyond ~45°; polymer is self-supporting. */
const OVERHANG_THRESHOLD_DEG = 45;
/** A plate this large (mm², ≈ 63×63 mm) is treated as a full warpage risk. */
const PLATE_REFERENCE_MM2 = 4000;

/** Faces with |normal.z| / len > this are "near-horizontal plates". */
const FLAT_NZ = 0.8;

function faceGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  t: number,
): { area: number; flat: boolean; nzNorm: number } | null {
  const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
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
  if (len < 1e-9) return null;
  const nzNorm = nz / len;
  return { area: len / 2, flat: Math.abs(nzNorm) > FLAT_NZ, nzNorm };
}

export function computePbfMetrics(
  model: GeometryModel,
  kind: PbfKind,
  graph?: GeometryGraph | null,
): PbfResult {
  const { positions, indices, triangleCount } = model;
  const g = graph ?? buildGeometryGraph(model);

  // ── Connected components → shell count / powder trap ──────────────────────
  const visited = new Uint8Array(triangleCount);
  const components: number[][] = [];
  if (g && g.faceNeighbors.length > 0) {
    for (let t = 0; t < triangleCount; t++) {
      if (visited[t]) continue;
      const comp: number[] = [];
      const stack = [t];
      visited[t] = 1;
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
    components.push(Array.from({ length: triangleCount }, (_, i) => i));
  }

  // ── Flat plates (largest connected near-horizontal region) ────────────────
  const isFlat = new Uint8Array(triangleCount);
  const faceArea = new Float64Array(triangleCount);
  let totalArea = 0;
  let flatArea = 0;
  let footprintArea = 0;
  for (let t = 0; t < triangleCount; t++) {
    const fg = faceGeometry(positions, indices, t);
    if (!fg) continue;
    faceArea[t] = fg.area;
    totalArea += fg.area;
    if (fg.flat) { isFlat[t] = 1; flatArea += fg.area; }
    footprintArea += fg.area * Math.abs(fg.nzNorm);
  }

  let largestFlatPlate = 0;
  if (g && g.faceNeighbors.length > 0) {
    const visitedFlat = new Uint8Array(triangleCount);
    for (let t = 0; t < triangleCount; t++) {
      if (!isFlat[t] || visitedFlat[t]) continue;
      const stack = [t];
      visitedFlat[t] = 1;
      let compArea = 0;
      while (stack.length) {
        const cur = stack.pop()!;
        compArea += faceArea[cur];
        const start = g.faceNeighborStart[cur];
        const end = g.faceNeighborStart[cur + 1];
        for (let k = start; k < end; k++) {
          const nb = g.faceNeighbors[k];
          if (isFlat[nb] && !visitedFlat[nb]) { visitedFlat[nb] = 1; stack.push(nb); }
        }
      }
      if (compArea > largestFlatPlate) largestFlatPlate = compArea;
    }
  } else if (flatArea > 0) {
    largestFlatPlate = flatArea;
  }

  // ── Overhang (metal support need) ─────────────────────────────────────────
  const thresholds = getThresholds();
  const oh = analyzeOverhang(positions, indices, OVERHANG_THRESHOLD_DEG, thresholds);

  // ── Distortion / residual-stress risk proxy ───────────────────────────────
  const flatRisk = Math.min(1, Math.max(flatArea > 0 ? flatArea / totalArea : 0, largestFlatPlate / PLATE_REFERENCE_MM2));
  const selfSupporting = kind !== 'slm';
  const distortionRisk = selfSupporting
    ? Math.min(1, 0.8 * flatRisk + 0.2 * oh.ratio)
    : Math.min(1, 0.55 * flatRisk + 0.45 * oh.ratio + (components.length > 1 ? 0.1 : 0));

  // ── Orientation advice ─────────────────────────────────────────────────────
  const orientation: PbfResult['orientation'] = (() => {
    if (components.length > 1 && oh.ratio > 0.3) return 'reorient';
    if (!selfSupporting && oh.ratio > 0.15) return 'reorient'; // metal: too many unsupported faces
    if (distortionRisk > 0.55) return 'tilt';
    return 'upright';
  })();

  return {
    kind,
    shellCount: components.length,
    powderTrap: components.length > 1,
    largestFlatPlateMm2: Math.round(largestFlatPlate * 100) / 100,
    flatPlateRatio: totalArea > 0 ? flatArea / totalArea : 0,
    overhangRatio: oh.ratio,
    overhangAreaMm2: Math.round(oh.overhangAreaMm2 * 100) / 100,
    distortionRisk,
    selfSupporting,
    footprintAreaMm2: Math.round(footprintArea * 100) / 100,
    orientation,
  };
}
