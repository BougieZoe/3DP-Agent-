/**
 * Topology profiles — the abstraction layer that keeps verdicts honest when the
 * *upstream* changes the kind of mesh we are handed.
 *
 * ── Why this module exists ────────────────────────────────────────────────────
 * Every threshold in `thresholds.ts` was calibrated against triangle meshes that
 * came out of a CAD kernel. Upstream generators are moving (e.g. Tripo P2.0 emits
 * quad-dominant topology because it is editable downstream), and each move shifts
 * the statistical baseline of the mesh without changing anything a human would
 * call "the part". A wall that is 0.8 mm thick is still 0.8 mm thick — but the
 * *edge census* used to infer watertightness is not comparable between a quad
 * surface and a triangle surface.
 *
 * The failure mode we are preventing: thresholds silently migrate from "measured
 * against CAD triangles" to "applied to AI quads", and the verdict keeps its
 * confident tone while its meaning quietly rots. That is worse than a wrong
 * verdict, because nobody re-examines a green check mark.
 *
 * ── The design pattern: same shape as i18n, on purpose ────────────────────────
 * This mirrors `shared/i18n/`: a flat data dictionary keyed by a composite id,
 * a deterministic fallback chain, and pure lookup functions with no I/O. Adding
 * a new upstream or topology never touches the analysis modules — it adds a row.
 *
 *   i18n fallback:   exact key → `en` → `null`
 *   here fallback:   `${provenance}:${kind}` → `unknown:${kind}` → `default`
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────
 * No I/O, no network probing of upstream services, no model-name sniffing. We
 * classify what the mesh *is*, never who made it. The provenance hint is an
 * opt-in from the caller (file name / importer generator string); geometry is
 * the only evidence this module trusts on its own.
 */

import type { GeometryModel } from './geometryModel';
import type { ThresholdsOverride } from './thresholds';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The dominant face topology of a mesh.
 *
 * We model only `tri` and `quad`. Higher-order n-gons exist, but slicers
 * triangulate them anyway, and a third bucket would multiply the profile matrix
 * without changing a verdict. Anything we cannot classify lands in `unknown`,
 * which is a first-class state — not an error.
 */
export type TopologyKind = 'tri' | 'quad' | 'unknown';

/**
 * Where the mesh came from. This is a *prior on the upstream contract*, not a
 * claim about quality:
 *  - `cad`           kernel tessellation — clean, consistent winding, mm-true
 *  - `ai-generation` text/image-to-3D output — quad-dominant, uneven face
 *                    density, scale frequently guessed
 *  - `scan`          captured geometry — dense, noisy, high genus, open boundaries
 *  - `slicer`        re-imported from a slicer / repaired mesh — may be pre-split
 *  - `unknown`       no hint from the caller
 */
export type MeshProvenance = 'cad' | 'ai-generation' | 'scan' | 'slicer' | 'unknown';

/** Fully-qualified profile id — composite of provenance and kind. */
export type TopologyProfileId = `${MeshProvenance}:${TopologyKind}` | 'default';

// ─── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * Cheap, format-agnostic statistics that let us tell triangle and quad surfaces
 * apart *after* a quad mesh has already been triangulated by the importer.
 *
 * The load-bearing signal is `coplanarPairRatio`. Triangulating a quad emits one
 * interior diagonal per quad; that diagonal is shared by exactly two triangles
 * that are, by construction, perfectly coplanar. On a genuine triangle mesh —
 * even a flat one — adjacent faces are coplanar only by tessellation accident.
 * So a high coplanar share means "this was quads, we just lost the labels".
 */
export interface TopologyFingerprint {
  vertexCount: number;
  triangleCount: number;
  edgeCount: number;
  /** 2E/V. Closed triangle meshes sit near 6; quad meshes near 4. */
  avgVertexDegree: number;
  /** F/V. Closed triangle meshes sit near 2; quad meshes near 1 before triangulation. */
  faceVertexRatio: number;
  /** V − E + F. One closed shell = 2; each extra handle subtracts 2. */
  eulerCharacteristic: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  /** Fraction of edges with exactly one incident face. */
  boundaryRatio: number;
  /**
   * Fraction of interior (2-face) edges whose two incident faces are coplanar to
   * within `COPLANAR_DOT` — the quad-triangulation signature.
   * Expect ≈0.20 for a triangulated quad mesh, ≈0 for a smooth triangle mesh.
   */
  coplanarPairRatio: number;
  /** True when the mesh exceeded the sweep budget and was partly sampled. */
  sampled: boolean;
}

/** Faces closer than ~0.8° apart count as coplanar. */
const COPLANAR_DOT = 0.9999;

/**
 * Hard ceiling on triangles walked for the coplanar census. Above this the mesh
 * is partially sampled and `sampled` is set, so downstream code can widen its
 * confidence instead of pretending the number is exact.
 */
const MAX_FINGERPRINT_TRIANGLES = 400_000;

/** Below this, classification is statistically meaningless. */
const MIN_TRIANGLES_FOR_CLASSIFICATION = 50;

/**
 * Compute a topology fingerprint from a geometry model.
 *
 * Single pass builds the edge→face adjacency, a second pass over the edge table
 * tests coplanarity. Pure, allocation-bounded, safe on the analysis worker.
 */
export function computeTopologyFingerprint(model: GeometryModel): TopologyFingerprint {
  const { indices, positions, vertexCount, triangleCount } = model;
  const hasIndex = indices.length >= 3 && vertexCount > 0;
  const budget = Math.min(triangleCount, MAX_FINGERPRINT_TRIANGLES);
  const sampled = triangleCount > budget;

  if (!hasIndex) {
    return {
      vertexCount,
      triangleCount,
      edgeCount: 0,
      avgVertexDegree: 0,
      faceVertexRatio: 0,
      eulerCharacteristic: 0,
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      boundaryRatio: 1,
      coplanarPairRatio: 0,
      sampled,
    };
  }

  const stride = vertexCount;

  // Edge → first face / second face. A third face is recorded in `overflow`
  // rather than tracked individually — we only need "is it manifold".
  const firstFace = new Map<number, number>();
  const secondFace = new Map<number, number>();
  const overflow = new Set<number>();

  // Cached unit normals for the faces we actually visit.
  const normals = new Float32Array(budget * 3);

  for (let f = 0; f < budget; f++) {
    const base = f * 3;
    const i0 = indices[base];
    const i1 = indices[base + 1];
    const i2 = indices[base + 2];

    // Face normal (unit) — computed once, reused for every edge of this face.
    const p0 = i0 * 3;
    const p1 = i1 * 3;
    const p2 = i2 * 3;
    if (p2 + 2 < positions.length) {
      const ux = positions[p1] - positions[p0];
      const uy = positions[p1 + 1] - positions[p0 + 1];
      const uz = positions[p1 + 2] - positions[p0 + 2];
      const vx = positions[p2] - positions[p0];
      const vy = positions[p2 + 1] - positions[p0 + 1];
      const vz = positions[p2 + 2] - positions[p0 + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len >= 1e-12) {
        normals[f * 3] = nx / len;
        normals[f * 3 + 1] = ny / len;
        normals[f * 3 + 2] = nz / len;
      }
    }

    const k0 = packEdge(i0, i1, stride);
    const k1 = packEdge(i1, i2, stride);
    const k2 = packEdge(i2, i0, stride);

    for (let e = 0; e < 3; e++) {
      const key = e === 0 ? k0 : e === 1 ? k1 : k2;
      if (!firstFace.has(key)) {
        firstFace.set(key, f);
      } else if (!secondFace.has(key)) {
        secondFace.set(key, f);
      } else {
        overflow.add(key);
      }
    }
  }

  let boundaryEdgeCount = 0;
  let interiorEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let coplanarPairs = 0;

  for (const [key, first] of firstFace) {
    if (overflow.has(key)) {
      nonManifoldEdgeCount++;
      continue;
    }
    const second = secondFace.get(key);
    if (second === undefined) {
      boundaryEdgeCount++;
      continue;
    }
    interiorEdgeCount++;
    if (areCoplanar(normals, first, second)) coplanarPairs++;
  }

  const edgeCount = boundaryEdgeCount + interiorEdgeCount + nonManifoldEdgeCount;
  const safeVertexCount = Math.max(vertexCount, 1);
  const effectiveTriangles = budget;

  return {
    vertexCount,
    triangleCount,
    edgeCount,
    avgVertexDegree: (2 * edgeCount) / safeVertexCount,
    faceVertexRatio: effectiveTriangles / safeVertexCount,
    eulerCharacteristic: safeVertexCount - edgeCount + effectiveTriangles,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    boundaryRatio: edgeCount > 0 ? boundaryEdgeCount / edgeCount : 1,
    coplanarPairRatio: interiorEdgeCount > 0 ? coplanarPairs / interiorEdgeCount : 0,
    sampled,
  };
}

function packEdge(a: number, b: number, stride: number): number {
  // min * stride + max stays below 2^52 for any mesh the importer accepts
  // (vertexCount < 2^26), so this remains an exact Number key.
  return a <= b ? a * stride + b : b * stride + a;
}

/** True when the two cached normals point the same way (within ~0.8°). */
function areCoplanar(normals: Float32Array, faceA: number, faceB: number): boolean {
  const a = faceA * 3;
  const b = faceB * 3;
  const dot =
    normals[a] * normals[b] +
    normals[a + 1] * normals[b + 1] +
    normals[a + 2] * normals[b + 2];
  return dot >= COPLANAR_DOT;
}

// ─── Classification ───────────────────────────────────────────────────────────

export interface TopologyDetection {
  kind: TopologyKind;
  /** 0..1 — how strongly the fingerprint supports `kind`. */
  confidence: number;
  /** Evidence trail, safe to surface in a report. */
  evidence: string[];
}

/**
 * Classify a fingerprint as triangle- or quad-dominant.
 *
 * ── Why coplanar share is the only primary signal ────────────────────────────
 * The obvious first idea — "quad meshes have lower vertex degree" — is wrong for
 * us, because we almost never see a quad mesh. By the time geometry reaches the
 * analysis layer the importer has triangulated it, and a triangulated quad
 * surface has the *same* V/E/F census as a triangle surface (E = 3F/2 either
 * way, V − E + F = 2 either way, mean degree ≈ 6 either way). Degree therefore
 * cannot separate them after the fact and is kept as supporting evidence only.
 *
 * What survives triangulation is the *diagonal*: splitting a quad emits one
 * interior edge whose two incident triangles are coplanar by construction. For
 * a quad-dominant mesh that is ~1 of every 3 interior edges (~0.33); for a
 * genuinely curved triangle mesh adjacent faces are coplanar only by accident
 * (≈0). That is the signal we trust.
 *
 * The bands are deliberately wide. We are not chasing precision — we are
 * avoiding the application of the wrong profile *with a confident tone*. When
 * the signal is ambiguous the answer is `unknown` at low confidence, which lets
 * the caller fall back to the conservative default.
 */
export function classifyTopology(fingerprint: TopologyFingerprint): TopologyDetection {
  const evidence: string[] = [
    `coplanarPairRatio=${fingerprint.coplanarPairRatio.toFixed(3)}`,
    `avgVertexDegree=${fingerprint.avgVertexDegree.toFixed(2)}`,
    `faceVertexRatio=${fingerprint.faceVertexRatio.toFixed(2)}`,
    `boundaryRatio=${fingerprint.boundaryRatio.toFixed(2)}`,
  ];

  if (fingerprint.triangleCount < MIN_TRIANGLES_FOR_CLASSIFICATION) {
    return {
      kind: 'unknown',
      confidence: 0.1,
      evidence: [...evidence, `mesh too small to classify (${fingerprint.triangleCount} triangles)`],
    };
  }

  const { coplanarPairRatio: cpr, boundaryRatio } = fingerprint;

  // Open, fully coplanar sheet: a flat plane triangulated by anyone. The
  // diagonal signature is indistinguishable from an ordinary flat tessellation
  // here, and a flat sheet has no meaningful topology contract anyway.
  if (boundaryRatio > 0.3 && cpr >= 0.55) {
    return {
      kind: 'unknown',
      confidence: 0.3,
      evidence: [...evidence, 'open flat sheet — topology kind not recoverable'],
    };
  }

  // One coplanar diagonal per quad, walked over interior edges → ~0.33.
  if (cpr >= 0.22) {
    return {
      kind: 'quad',
      confidence: 0.85,
      evidence: [...evidence, 'coplanar interior diagonals dominate → quad-dominant source'],
    };
  }

  // Partial signature: quad patches mixed into a triangle mesh, or a quad surface
  // with non-planar faces that broke some diagonals.
  if (cpr >= 0.1) {
    return {
      kind: 'quad',
      confidence: 0.55,
      evidence: [...evidence, 'partial coplanar diagonal signature → likely quad-dominant'],
    };
  }

  // Curved triangle meshes: adjacent faces differ by real curvature.
  if (cpr < 0.05) {
    return {
      kind: 'tri',
      confidence: 0.85,
      evidence: [...evidence, 'no coplanar diagonal signature → triangle source'],
    };
  }

  return {
    kind: 'unknown',
    confidence: 0.4,
    evidence: [...evidence, 'coplanar share sits in the ambiguous band'],
  };
}

// ─── Provenance hinting ───────────────────────────────────────────────────────

/**
 * Infer provenance from a file name or an importer-supplied generator string.
 *
 * This is a *hint*, never proof — it only selects which profile row to try
 * first. A wrong hint degrades to the same behaviour as no hint, because the
 * fallback chain still lands on a valid profile.
 */
export function inferProvenance(hint?: string): {
  provenance: MeshProvenance;
  confidence: number;
} {
  if (!hint) return { provenance: 'unknown', confidence: 0 };

  const h = hint.toLowerCase();
  // `_`, `-` and `.` are word characters or boundaries in unhelpful ways:
  // `\bmeshy\b` does NOT match `meshy_export` because `_` counts as \w. Fold
  // every separator to a space first so keyword matching behaves as intended.
  // The raw `h` is kept for extension checks, which need the dot.
  const hn = ` ${h.replace(/[^a-z0-9]+/g, ' ').trim()} `;

  if (/\b(tripo|meshy|rodin|hunyuan3d|luma|trellis|wonder3d|instantmesh|slat)\b/.test(hn)) {
    return { provenance: 'ai-generation', confidence: 0.8 };
  }
  if (/\b(fusion360|solidworks|onshape|freecad|rhino|creo|cadquery|build123d|opencascade|occ|step|iges)\b/.test(hn)) {
    return { provenance: 'cad', confidence: 0.8 };
  }
  if (/\b(scan|scanner|scanned|photogrammetry|reality|metashape|recap|structured light)\b/.test(hn)) {
    return { provenance: 'scan', confidence: 0.7 };
  }
  if (/\b(prusaslicer|orcaslicer|cura|bambu|slicer|prepared|repaired)\b/.test(hn)) {
    return { provenance: 'slicer', confidence: 0.6 };
  }

  // Extension-only hints are weak — a container format must never override what
  // the geometry itself says.
  if (/\.(glb|gltf)$/.test(h)) return { provenance: 'ai-generation', confidence: 0.3 };
  if (/\.(stl|3mf|obj|ply)$/.test(h)) return { provenance: 'unknown', confidence: 0.2 };

  return { provenance: 'unknown', confidence: 0.2 };
}

// ─── Judging rules: the part thresholds.ts cannot hold ────────────────────────

/**
 * Structural switches that depend on *which family of criteria* is in force.
 *
 * A threshold is a number ("min wall = 0.8 mm"). These are switches ("does a
 * coplanar interior edge count as degenerate geometry?"). Mixing them into
 * `thresholds.ts` would put quad-specific behaviour behind a numeric override,
 * which is the wrong knob — you would have to set it to 0 or 1 and hope.
 *
 * STATUS: declarative today. These switches travel into the analysis result so
 * reporting can read them, but no scoring module consumes them yet — the
 * verdict layer still runs a single criteria family (triangle flow). A
 * `quad-flow` profile therefore means "we know what the right question is",
 * not "we have answered it". Wiring these into the verdict path is a separate,
 * reviewed change; implying otherwise would make every quad report look judged
 * when it is not.
 */
export interface JudgingRules {
  /**
   * A coplanar interior edge is a quad-triangulation artifact, not a defect.
   * When true, degenerate/sliver checks ignore edges whose incident faces are
   * coplanar — otherwise every quad mesh is reported as sliver-infested.
   */
  coplanarEdgesAreArtifacts: boolean;
  /**
   * Shell count is only a meaningful quality signal for closed single-part
   * tessellations. Scans and pre-split slicer output routinely report many
   * shells that are not a user-facing problem.
   */
  shellCountMeaningful: boolean;
  /**
   * Strength of vertex-degree-based uniformity checks. `skip` means the mesh
   * genuinely has no uniform tessellation contract to violate.
   */
  degreeCheck: 'strict' | 'relaxed' | 'skip';
  /**
   * Which notion of "good topology" governs this mesh.
   *  - `triangle-flow`: manifoldness, shell count, winding consistency
   *  - `quad-flow`: edge loops follow the load path, poles placed intentionally;
   *    triangle flow metrics are reported but must not drive the verdict
   *  - `mixed`: both families reported, neither dominant
   *  - `uncalibrated`: we lack evidence to apply either — report only
   */
  criteria: 'triangle-flow' | 'quad-flow' | 'mixed' | 'uncalibrated';
}

// ─── Profile registry (the "catalog", i18n-shaped) ────────────────────────────

export interface TopologyProfile {
  /** Stable id and fallback-chain key. */
  id: TopologyProfileId;
  kind: TopologyKind;
  provenance: MeshProvenance;
  /** Numeric overrides layered on DEFAULT_ANALYSIS_THRESHOLDS. Empty = inherit. */
  thresholds: ThresholdsOverride;
  /** Structural switches — see JudgingRules. */
  rules: JudgingRules;
  /**
   * `provisional` means the numbers are reasoned but not yet measured against
   * physical print outcomes. Reports must say so; nothing here is presented as
   * validated ground truth until a calibration run replaces it.
   */
  calibration: 'default' | 'provisional' | 'measured';
  /** i18n catalog key describing this profile to a human. */
  descriptionKey: string;
}

const TRI_RULES: JudgingRules = {
  coplanarEdgesAreArtifacts: false,
  shellCountMeaningful: true,
  degreeCheck: 'strict',
  criteria: 'triangle-flow',
};

const QUAD_RULES: JudgingRules = {
  coplanarEdgesAreArtifacts: true,
  shellCountMeaningful: true,
  degreeCheck: 'relaxed',
  criteria: 'quad-flow',
};

const SCAN_RULES: JudgingRules = {
  coplanarEdgesAreArtifacts: false,
  shellCountMeaningful: false,
  degreeCheck: 'skip',
  criteria: 'mixed',
};

/**
 * The registry. Rows are data — supporting a new upstream means adding a row,
 * never editing an analysis module.
 *
 * `default` stays behaviourally identical to pre-profile 3DP Agent so that
 * verdicts do not shift under the feet of anyone reading a historical report.
 */
export const TOPOLOGY_PROFILES: Record<string, TopologyProfile> = {
  default: {
    id: 'default',
    kind: 'unknown',
    provenance: 'unknown',
    thresholds: {},
    rules: {
      coplanarEdgesAreArtifacts: false,
      shellCountMeaningful: true,
      degreeCheck: 'relaxed',
      criteria: 'uncalibrated',
    },
    calibration: 'default',
    descriptionKey: 'topology.profile.default',
  },

  // ── CAD tessellation ────────────────────────────────────────────────────────
  'cad:tri': {
    id: 'cad:tri',
    kind: 'tri',
    provenance: 'cad',
    thresholds: {},
    rules: TRI_RULES,
    calibration: 'default',
    descriptionKey: 'topology.profile.cadTri',
  },
  'cad:quad': {
    id: 'cad:quad',
    kind: 'quad',
    provenance: 'cad',
    thresholds: {},
    rules: QUAD_RULES,
    calibration: 'provisional',
    descriptionKey: 'topology.profile.cadQuad',
  },

  // ── AI generation ───────────────────────────────────────────────────────────
  // Quad-dominant by design since Tripo P2.0 and peers. Scale is frequently a
  // guess and face density is uneven, so the profile relaxes nothing about
  // physical truth (wall thickness stays physical) — only the statistical
  // topology indicators that assume uniform tessellation.
  'ai-generation:quad': {
    id: 'ai-generation:quad',
    kind: 'quad',
    provenance: 'ai-generation',
    thresholds: {},
    rules: QUAD_RULES,
    calibration: 'provisional',
    descriptionKey: 'topology.profile.aiQuad',
  },
  'ai-generation:tri': {
    id: 'ai-generation:tri',
    kind: 'tri',
    provenance: 'ai-generation',
    thresholds: {},
    rules: TRI_RULES,
    calibration: 'provisional',
    descriptionKey: 'topology.profile.aiTri',
  },

  // ── Scans ───────────────────────────────────────────────────────────────────
  // Dense, noisy, high genus. Shell counts are meaningless (a scan of a part on
  // a table is one shell plus floor noise), so this profile declares itself
  // uncalibrated rather than silently reusing the CAD baseline.
  'scan:tri': {
    id: 'scan:tri',
    kind: 'tri',
    provenance: 'scan',
    thresholds: {},
    rules: SCAN_RULES,
    calibration: 'provisional',
    descriptionKey: 'topology.profile.scanTri',
  },
  'scan:quad': {
    id: 'scan:quad',
    kind: 'quad',
    provenance: 'scan',
    thresholds: {},
    rules: { ...QUAD_RULES, shellCountMeaningful: false },
    calibration: 'provisional',
    descriptionKey: 'topology.profile.scanQuad',
  },

  // ── Slicer re-imports ───────────────────────────────────────────────────────
  'slicer:tri': {
    id: 'slicer:tri',
    kind: 'tri',
    provenance: 'slicer',
    thresholds: {},
    rules: { ...TRI_RULES, shellCountMeaningful: false },
    calibration: 'provisional',
    descriptionKey: 'topology.profile.slicerTri',
  },
  'slicer:quad': {
    id: 'slicer:quad',
    kind: 'quad',
    provenance: 'slicer',
    thresholds: {},
    rules: { ...QUAD_RULES, shellCountMeaningful: false },
    calibration: 'provisional',
    descriptionKey: 'topology.profile.slicerQuad',
  },

  // ── Kind-only rows (fallback tier) ──────────────────────────────────────────
  // Reached when a hint was supplied but no provenance-specific row exists.
  'unknown:tri': {
    id: 'unknown:tri',
    kind: 'tri',
    provenance: 'unknown',
    thresholds: {},
    rules: TRI_RULES,
    calibration: 'default',
    descriptionKey: 'topology.profile.unknownTri',
  },
  'unknown:quad': {
    id: 'unknown:quad',
    kind: 'quad',
    provenance: 'unknown',
    thresholds: {},
    rules: QUAD_RULES,
    calibration: 'provisional',
    descriptionKey: 'topology.profile.unknownQuad',
  },
};

/** Kind-keyed fallback rows, consulted when the exact composite id is missing. */
const KIND_FALLBACK: Record<TopologyKind, TopologyProfileId> = {
  tri: 'unknown:tri',
  quad: 'unknown:quad',
  unknown: 'default',
};

export interface ProfileResolution {
  profile: TopologyProfile;
  /** Which fallback tier answered — surfaced in reports and asserted in tests. */
  tier: 'exact' | 'kind' | 'default';
  notes: string[];
}

/**
 * Resolve a profile through the fallback chain:
 *   `${provenance}:${kind}` → `unknown:${kind}` → `default`
 *
 * Total function: never throws, never returns undefined. An upstream we have
 * never seen degrades to a conservative, clearly-labelled baseline instead of
 * failing an analysis run.
 */
export function resolveTopologyProfile(
  provenance: MeshProvenance,
  kind: TopologyKind,
): ProfileResolution {
  const exact = `${provenance}:${kind}`;
  const exactRow = TOPOLOGY_PROFILES[exact];
  if (exactRow) {
    return { profile: exactRow, tier: 'exact', notes: [`exact profile ${exact}`] };
  }

  const kindRow = KIND_FALLBACK[kind];
  if (kindRow === 'default') {
    return {
      profile: TOPOLOGY_PROFILES.default,
      tier: 'default',
      notes: [`no row for ${exact} and topology kind is unclassified; using default`],
    };
  }

  const kindProfile = kindRow ? TOPOLOGY_PROFILES[kindRow] : undefined;
  if (kindProfile) {
    return {
      profile: kindProfile,
      tier: 'kind',
      notes: [`no row for ${exact}; fell back to ${kindRow} on topology kind`],
    };
  }

  return {
    profile: TOPOLOGY_PROFILES.default,
    tier: 'default',
    notes: [`no profile covers ${exact}; using conservative default`],
  };
}

/**
 * One-shot entry point: fingerprint the model, classify it, and resolve the
 * profile that should judge it. Returns the evidence trail so a report can
 * justify the choice rather than asserting it.
 */
export interface TopologyProfileSelection {
  profile: TopologyProfile;
  detection: TopologyDetection;
  fingerprint: TopologyFingerprint;
  resolution: ProfileResolution;
  provenance: MeshProvenance;
  provenanceConfidence: number;
}

export function selectTopologyProfile(
  model: GeometryModel,
  provenanceHint?: string,
): TopologyProfileSelection {
  const fingerprint = computeTopologyFingerprint(model);
  const detection = classifyTopology(fingerprint);
  const hinted = inferProvenance(provenanceHint);
  const resolution = resolveTopologyProfile(hinted.provenance, detection.kind);

  return {
    profile: resolution.profile,
    detection,
    fingerprint,
    resolution,
    provenance: hinted.provenance,
    provenanceConfidence: hinted.confidence,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Layer two threshold overrides, `override` winning field by field at every
 * depth.
 *
 * A shallow spread is not good enough here: once both the profile and the
 * caller mention `wallThickness`, a spread replaces the whole group and
 * silently drops the sibling fields the other side set. Thresholds are also
 * where a wrong merge would be least visible and most expensive — it would
 * shift verdicts without changing any code that looks like it decides
 * anything.
 *
 * Precedence: profile baseline < explicit caller override. A per-run override
 * always outranks a profile default, because the caller is describing *this*
 * print rather than a class of geometry.
 */
function mergeDeep(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const previous = merged[key];
    merged[key] =
      isPlainObject(previous) && isPlainObject(value)
        ? mergeDeep(previous, value)
        : value;
  }
  return merged;
}

/**
 * Declared via `unknown` on purpose: `ThresholdsOverride` is a recursive mapped
 * type, and any bare `{}` literal annotated with it makes TypeScript try to
 * instantiate the mapped type and reject it as self-referential (TS2615).
 */
const EMPTY_THRESHOLDS_OVERRIDE = {} as unknown as ThresholdsOverride;

export function mergeThresholdOverrides(
  base?: ThresholdsOverride,
  override?: ThresholdsOverride,
): ThresholdsOverride {
  if (!base) return override ?? EMPTY_THRESHOLDS_OVERRIDE;
  if (!override) return base;
  // Typed at the boundary only: `ThresholdsOverride` is a recursive mapped
  // type, so recursing on it directly makes TypeScript reject the definition
  // as self-referential. The recursion itself is plain structural merging.
  return mergeDeep(
    base as unknown as Record<string, unknown>,
    override as unknown as Record<string, unknown>,
  ) as unknown as ThresholdsOverride;
}
