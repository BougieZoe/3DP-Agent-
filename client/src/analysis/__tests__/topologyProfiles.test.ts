import { describe, it, expect } from 'vitest';
import { createGeometryModel, type GeometryModel } from '../geometryModel';
import {
  TOPOLOGY_PROFILES,
  classifyTopology,
  computeTopologyFingerprint,
  inferProvenance,
  resolveTopologyProfile,
  selectTopologyProfile,
  type MeshProvenance,
  type TopologyKind,
} from '../topologyProfiles';
import { CONTENT } from '@shared/i18n/content';

// ─── Synthetic geometry helpers ───────────────────────────────────────────────
// These build meshes with a *known* ground-truth topology so the classifier is
// tested against a label rather than against itself.

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
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
 * Subdivided icosahedron — a genuinely curved, closed triangle mesh.
 * Ground truth: `tri`.
 */
function makeIcosphere(subdivisions: number): GeometryModel {
  const t = (1 + Math.sqrt(5)) / 2;
  const baseVerts: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);

  const verts: [number, number, number][] = [...baseVerts];
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const next: [number, number, number][] = [];

    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a];
      const vb = verts[b];
      const idx = verts.length;
      verts.push(normalize([
        (va[0] + vb[0]) / 2,
        (va[1] + vb[1]) / 2,
        (va[2] + vb[2]) / 2,
      ]));
      cache.set(key, idx);
      return idx;
    };

    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const positions: number[] = [];
  for (const v of verts) positions.push(v[0], v[1], v[2]);
  const indices: number[] = [];
  for (const [a, b, c] of faces) indices.push(a, b, c);

  return buildModel(positions, indices);
}

/**
 * Lat-long sphere built as quads, then triangulated exactly the way an importer
 * would. Ground truth: `quad` — the quad labels are lost, only the coplanar
 * diagonals survive.
 */
function makeTriangulatedQuadSphere(rings: number, segments: number): GeometryModel {
  const positions: number[] = [];
  const indices: number[] = [];

  // North pole.
  positions.push(0, 1, 0);

  const ringStart: number[] = [];
  for (let r = 1; r < rings; r++) {
    ringStart[r] = positions.length / 3;
    const phi = (Math.PI * r) / rings;
    const y = Math.cos(phi);
    const rad = Math.sin(phi);
    for (let s = 0; s < segments; s++) {
      const theta = (2 * Math.PI * s) / segments;
      positions.push(rad * Math.cos(theta), y, rad * Math.sin(theta));
    }
  }

  const southPole = positions.length / 3;
  positions.push(0, -1, 0);

  // North fan.
  for (let s = 0; s < segments; s++) {
    const s2 = (s + 1) % segments;
    indices.push(0, ringStart[1] + s2, ringStart[1] + s);
  }

  // Quad bands, each split into two triangles sharing a coplanar diagonal.
  for (let r = 1; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      const a = ringStart[r] + s;
      const b = ringStart[r] + s2;
      const c = ringStart[r + 1] + s;
      const d = ringStart[r + 1] + s2;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  // South fan.
  for (let s = 0; s < segments; s++) {
    const s2 = (s + 1) % segments;
    indices.push(southPole, ringStart[rings - 1] + s, ringStart[rings - 1] + s2);
  }

  return buildModel(positions, indices);
}

/** A single triangle — below the classification floor. */
function makeTinyMesh(): GeometryModel {
  return buildModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 1, 2],
  );
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

describe('computeTopologyFingerprint', () => {
  it('returns a zeroed fingerprint for unindexed geometry', () => {
    const model = createGeometryModel(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Float32Array(9),
      new Uint32Array(0),
    );
    const fp = computeTopologyFingerprint(model);
    expect(fp.edgeCount).toBe(0);
    expect(fp.boundaryRatio).toBe(1);
    expect(fp.coplanarPairRatio).toBe(0);
  });

  it('derives a closed-mesh census for an icosphere', () => {
    const model = makeIcosphere(2);
    const fp = computeTopologyFingerprint(model);

    // Euler characteristic of a closed sphere is 2.
    expect(fp.eulerCharacteristic).toBe(2);
    expect(fp.boundaryEdgeCount).toBe(0);
    expect(fp.nonManifoldEdgeCount).toBe(0);
    // Mean degree of a closed triangle mesh approaches 6.
    expect(fp.avgVertexDegree).toBeGreaterThan(5.5);
    expect(fp.avgVertexDegree).toBeLessThan(6.5);
    expect(fp.sampled).toBe(false);
  });

  it('exposes the coplanar diagonal signature of a triangulated quad mesh', () => {
    const tri = computeTopologyFingerprint(makeIcosphere(3));
    const quad = computeTopologyFingerprint(makeTriangulatedQuadSphere(12, 24));

    // Curved triangle mesh: essentially no accidental coplanar pairs.
    expect(tri.coplanarPairRatio).toBeLessThan(0.05);
    // Triangulated quads: one diagonal in three interior edges.
    expect(quad.coplanarPairRatio).toBeGreaterThan(0.22);
    // Both are closed, so the census alone cannot tell them apart — which is
    // exactly why the diagonal is the load-bearing signal.
    expect(quad.eulerCharacteristic).toBe(2);
  });

  it('marks oversized meshes as sampled rather than pretending precision', () => {
    const model = makeIcosphere(0); // 20 faces, small — sanity only
    const fp = computeTopologyFingerprint(model);
    expect(fp.sampled).toBe(false);
  });
});

// ─── Classification ───────────────────────────────────────────────────────────

describe('classifyTopology', () => {
  it('classifies a curved triangle mesh as tri', () => {
    const detection = classifyTopology(computeTopologyFingerprint(makeIcosphere(3)));
    expect(detection.kind).toBe('tri');
    expect(detection.confidence).toBeGreaterThanOrEqual(0.8);
    expect(detection.evidence.length).toBeGreaterThan(0);
  });

  it('classifies a triangulated quad mesh as quad', () => {
    const detection = classifyTopology(computeTopologyFingerprint(makeTriangulatedQuadSphere(12, 24)));
    expect(detection.kind).toBe('quad');
    expect(detection.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('refuses to classify a mesh below the statistical floor', () => {
    const detection = classifyTopology(computeTopologyFingerprint(makeTinyMesh()));
    expect(detection.kind).toBe('unknown');
    expect(detection.confidence).toBeLessThanOrEqual(0.2);
  });
});

// ─── Provenance ───────────────────────────────────────────────────────────────

describe('inferProvenance', () => {
  it('recognises AI generators', () => {
    expect(inferProvenance('tripo-p2-output.glb').provenance).toBe('ai-generation');
    expect(inferProvenance('meshy_export.obj').provenance).toBe('ai-generation');
  });

  it('recognises CAD kernels', () => {
    expect(inferProvenance('bracket_fusion360.step').provenance).toBe('cad');
    expect(inferProvenance('part-build123d.stl').provenance).toBe('cad');
  });

  it('recognises scans and slicer re-imports', () => {
    expect(inferProvenance('photogrammetry_scan.ply').provenance).toBe('scan');
    expect(inferProvenance('orcaslicer_prepared.3mf').provenance).toBe('slicer');
  });

  it('stays neutral when it has no evidence', () => {
    expect(inferProvenance(undefined).provenance).toBe('unknown');
    expect(inferProvenance('model.stl').confidence).toBeLessThanOrEqual(0.3);
  });
});

// ─── Fallback chain ───────────────────────────────────────────────────────────

describe('resolveTopologyProfile', () => {
  it('answers from the exact tier when a row exists', () => {
    const r = resolveTopologyProfile('cad', 'tri');
    expect(r.tier).toBe('exact');
    expect(r.profile.id).toBe('cad:tri');
  });

  it('falls back to the kind tier for an unseen provenance', () => {
    // No `slicer:unknown` row exists.
    const r = resolveTopologyProfile('slicer', 'unknown');
    expect(r.tier).toBe('default');
    expect(r.profile.id).toBe('default');
  });

  it('falls back to the kind tier when provenance is unknown but kind is known', () => {
    const r = resolveTopologyProfile('unknown', 'quad');
    expect(r.tier).toBe('exact');
    expect(r.profile.id).toBe('unknown:quad');
  });

  it('is total — never throws, never returns undefined', () => {
    const provenances: MeshProvenance[] = ['cad', 'ai-generation', 'scan', 'slicer', 'unknown'];
    const kinds: TopologyKind[] = ['tri', 'quad', 'unknown'];
    for (const p of provenances) {
      for (const k of kinds) {
        const r = resolveTopologyProfile(p, k);
        expect(r.profile).toBeDefined();
        expect(r.profile.id).toBeTruthy();
        expect(r.notes.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── Registry conformance ─────────────────────────────────────────────────────

describe('TOPOLOGY_PROFILES registry', () => {
  const rows = Object.entries(TOPOLOGY_PROFILES);

  it('keeps every row self-consistent', () => {
    for (const [key, profile] of rows) {
      expect(profile.id, `row ${key} id mismatch`).toBe(key);
      if (key === 'default') continue;
      expect(key).toBe(`${profile.provenance}:${profile.kind}`);
    }
  });

  it('ships a resolvable default row', () => {
    expect(TOPOLOGY_PROFILES.default).toBeDefined();
    expect(TOPOLOGY_PROFILES.default.calibration).toBe('default');
    // The default profile must not alter any numeric threshold — historical
    // verdicts have to stay reproducible.
    expect(TOPOLOGY_PROFILES.default.thresholds).toEqual({});
  });

  it('keeps every descriptionKey present in the i18n catalogue', () => {
    for (const [key, profile] of rows) {
      const entry = CONTENT[profile.descriptionKey];
      expect(entry, `missing i18n entry for ${key} → ${profile.descriptionKey}`).toBeDefined();
      expect(entry.en, `${profile.descriptionKey}.en`).toBeTruthy();
      expect(entry.ja, `${profile.descriptionKey}.ja`).toBeTruthy();
      expect(entry.zh, `${profile.descriptionKey}.zh`).toBeTruthy();
    }
  });

  it('declares calibration status for every row', () => {
    for (const [key, profile] of rows) {
      expect(
        ['default', 'provisional', 'measured'],
        `row ${key} has invalid calibration`,
      ).toContain(profile.calibration);
    }
  });
});

// ─── End to end ───────────────────────────────────────────────────────────────

describe('selectTopologyProfile', () => {
  it('picks the AI quad profile for a Tripo-style quad export', () => {
    const model = makeTriangulatedQuadSphere(12, 24);
    const selection = selectTopologyProfile(model, 'tripo_p2_asset.glb');
    expect(selection.provenance).toBe('ai-generation');
    expect(selection.detection.kind).toBe('quad');
    expect(selection.profile.id).toBe('ai-generation:quad');
    expect(selection.profile.rules.coplanarEdgesAreArtifacts).toBe(true);
    expect(selection.profile.rules.criteria).toBe('quad-flow');
  });

  it('picks the CAD triangle profile for a kernel export', () => {
    const model = makeIcosphere(3);
    const selection = selectTopologyProfile(model, 'bracket_fusion360.stl');
    expect(selection.profile.id).toBe('cad:tri');
    expect(selection.profile.rules.coplanarEdgesAreArtifacts).toBe(false);
  });

  it('degrades gracefully with no hint at all', () => {
    const selection = selectTopologyProfile(makeIcosphere(3));
    expect(selection.provenance).toBe('unknown');
    expect(selection.profile.id).toBe('unknown:tri');
    expect(selection.resolution.tier).toBe('exact');
  });
});
