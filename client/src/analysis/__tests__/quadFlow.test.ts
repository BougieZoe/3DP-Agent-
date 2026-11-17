import { describe, it, expect } from 'vitest';
import { createGeometryModel, type GeometryModel } from '../geometryModel';
import { buildGeometryGraph } from '../geometryGraph';
import { analyzeQuadFlow } from '../quadFlow';

// ─── Synthetic geometry ───────────────────────────────────────────────────────

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function buildModel(positions: number[], indices: number[]): GeometryModel {
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(positions.length);
  for (let i = 0; i < pos.length; i += 3) {
    const n = normalize([pos[i], pos[i + 1], pos[i + 2]]);
    nrm[i] = n[0];
    nrm[i + 1] = n[1];
    nrm[i + 2] = n[2];
  }
  return createGeometryModel(pos, nrm, new Uint32Array(indices), 'mm');
}

/**
 * A torus is the cleanest possible quad-flow fixture: every face is a quad,
 * every vertex has valence 4, there is no boundary, and its loops are two
 * families of closed rings with known lengths. Any deviation from those known
 * values is a real bug rather than a judgement call.
 */
function quadTorus(around: number, through: number): GeometryModel {
  const positions: number[] = [];
  const indices: number[] = [];
  const R = 1;
  const r = 0.35;

  for (let u = 0; u < around; u++) {
    const phi = (2 * Math.PI * u) / around;
    for (let v = 0; v < through; v++) {
      const theta = (2 * Math.PI * v) / through;
      const ring = R + r * Math.cos(theta);
      positions.push(ring * Math.cos(phi), r * Math.sin(theta), ring * Math.sin(phi));
    }
  }

  const idx = (u: number, v: number): number => (u % around) * through + (v % through);

  for (let u = 0; u < around; u++) {
    for (let v = 0; v < through; v++) {
      const a = idx(u, v);
      const b = idx(u + 1, v);
      const c = idx(u + 1, v + 1);
      const d = idx(u, v + 1);
      // Diagonal a–c, so the shared edge is the quad's diagonal.
      indices.push(a, b, c, a, c, d);
    }
  }

  return buildModel(positions, indices);
}

/** Same quad grid as above but laid flat — the degenerate case for reconstruction. */
function flatQuadGrid(rows: number, cols: number): GeometryModel {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      positions.push(j, 0, i);
    }
  }
  const idx = (i: number, j: number): number => i * (cols + 1) + j;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }
  return buildModel(positions, indices);
}

/** Icosphere-style triangle mesh: adjacent faces are genuinely not coplanar. */
function triangleSphere(subdivisions: number): GeometryModel {
  const t = (1 + Math.sqrt(5)) / 2;
  const base: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let positions = base.map(normalize);
  let faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const next: Array<[number, number, number]> = [];
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const p = normalize([
        positions[i][0] + positions[j][0],
        positions[i][1] + positions[j][1],
        positions[i][2] + positions[j][2],
      ]);
      positions.push(p);
      const index = positions.length - 1;
      cache.set(key, index);
      return index;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const positionsFlat: number[] = [];
  for (const p of positions) positionsFlat.push(p[0], p[1], p[2]);
  const indices: number[] = [];
  for (const f of faces) indices.push(f[0], f[1], f[2]);
  return buildModel(positionsFlat, indices);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('analyzeQuadFlow', () => {
  it('reports unusable without a graph', () => {
    expect(analyzeQuadFlow(null).reason).toBe('no-graph');
    expect(analyzeQuadFlow(undefined).applicable).toBe(false);
  });

  it('bails out below the triangle floor', () => {
    const model = flatQuadGrid(2, 2); // 8 triangles
    const graph = buildGeometryGraph(model);
    const result = analyzeQuadFlow(graph);
    expect(result.reason).toBe('too-small');
    expect(result.applicable).toBe(false);
    expect(result.quadFaceCount).toBe(0);
  });

  it('recovers a full quad layout on a closed quad mesh', () => {
    const around = 12;
    const through = 8;
    const graph = buildGeometryGraph(quadTorus(around, through));
    const result = analyzeQuadFlow(graph);

    const quadCount = around * through;
    expect(result.applicable).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.quadFaceCount).toBe(quadCount);
    // Every triangle belongs to exactly one reconstructed quad.
    expect(result.coverage).toBeCloseTo(1, 5);
  });

  it('finds no poles on a regular torus — every vertex is valence 4', () => {
    const result = analyzeQuadFlow(buildGeometryGraph(quadTorus(12, 8)));

    expect(result.poleCount).toBe(0);
    expect(result.poleRatio).toBe(0);
    expect(result.interiorVertexCount).toBe(12 * 8);
    expect(result.valenceHistogram).toEqual({ 4: 12 * 8 });
  });

  it('walks two families of closed edge loops with the known ring lengths', () => {
    const around = 12;
    const through = 8;
    const result = analyzeQuadFlow(buildGeometryGraph(quadTorus(around, through)));

    // One loop family wraps the ring (length `through`), the other passes
    // through the hole (length `around`). A torus closes both ways.
    expect(result.loops.count).toBe(around + through);
    expect(result.loops.closedRatio).toBe(1);
    expect(result.loops.maxLength).toBe(around);
    expect(result.loops.medianLength).toBe(through);
    expect(result.loops.isolatedCount).toBe(0);
  });

  it('is unambiguous on curved quads: only the diagonal is coplanar', () => {
    const result = analyzeQuadFlow(buildGeometryGraph(quadTorus(12, 8)));
    // Each triangle has exactly one coplanar neighbour — its diagonal partner.
    expect(result.ambiguityRatio).toBe(0);
  });

  it('refuses to guess on a flat quad grid where diagonals are indistinguishable', () => {
    const result = analyzeQuadFlow(buildGeometryGraph(flatQuadGrid(20, 20)));

    // Coverage looks perfect, yet on a plane the shared border of two quads is
    // exactly as coplanar as a diagonal. Publishing loop stats here would be
    // publishing a guess, so the reason says so instead.
    expect(result.ambiguityRatio).toBeGreaterThan(0.5);
    expect(result.reason).toBe('ambiguous');
    expect(result.applicable).toBe(false);
    // With every edge equally flat, no triangle can nominate a winner, so almost
    // nothing pairs up. That collapse is itself the evidence of ambiguity —
    // reporting it as "not a quad mesh" would blame the mesh for a limit of the
    // measurement.
    expect(result.coverage).toBeLessThan(0.1);
  });

  it('reports not-quad-dominant on a genuine triangle mesh', () => {
    const result = analyzeQuadFlow(buildGeometryGraph(triangleSphere(2)));

    expect(result.reason).toBe('not-quad-dominant');
    expect(result.applicable).toBe(false);
    // Coverage alone cannot settle this: mutual nomination finds partners on a
    // triangle mesh too, and roughly three quarters of triangles pair up. What
    // gives it away is that those pairs never chain into loops.
    expect(result.coverage).toBeGreaterThan(0.5);
    expect(result.loops.closedRatio).toBe(0);
    expect(result.loops.medianLength).toBeLessThan(3);
  });

  it('stays a quad layout at high subdivision instead of drifting into triangle-mesh territory', () => {
    const result = analyzeQuadFlow(buildGeometryGraph(quadTorus(32, 24)));

    expect(result.reason).toBe('ok');
    expect(result.quadFaceCount).toBe(32 * 24);
    expect(result.loops.closedRatio).toBe(1);
    expect(result.loops.maxLength).toBe(32);
  });

  it('never claims a verdict — no pass/fail field leaks into the result', () => {
    const result = analyzeQuadFlow(buildGeometryGraph(quadTorus(12, 8)));
    const keys = Object.keys(result);
    expect(keys).not.toContain('verdict');
    expect(keys).not.toContain('pass');
    expect(keys).not.toContain('score');
  });
});
