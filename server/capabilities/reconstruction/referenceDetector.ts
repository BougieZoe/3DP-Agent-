/**
 * Reference-object scale detection.
 *
 * Photogrammetry reconstructs up to similarity, so a mesh has correct geometry and an
 * arbitrary scale. The cheapest honest fix is to put an object of known size in the same
 * photo set — an A4 sheet or a bank card — and then measure *that object* in the mesh. The
 * measured length, divided into the reference's true length, is the missing factor.
 *
 * The hard part is not the arithmetic, it is finding the reference. This module does it
 * geometrically, without asking the user to click anything:
 *
 *   1. Cluster triangles by normal. A flat sheet is one big cluster of near-parallel faces;
 *      a curved subject splits into many small ones.
 *   2. Fit a plane per cluster and project the cluster's vertices onto it.
 *   3. Take the minimum-area bounding rectangle of that 2D point set.
 *   4. Accept a cluster when the rectangle's aspect ratio matches a known reference
 *      (A4 = 297/210, ISO/IEC 7810 ID-1 card = 85.60/53.98), the cluster actually fills the
 *      rectangle (a sphere's projected coverage is ~pi/4), and the cluster is flat enough
 *      that "rectangle corners" mean something.
 *
 * What this deliberately does not do: guess. When nothing matches, it returns the closest
 * candidates with their numbers so a human can see *why* the shot failed, and the caller can
 * fall back to the existing two_point reference. A plausible-but-wrong factor is worse than
 * no factor — it ships a part that is 12% off and labelled calibrated.
 */
import { isBinaryStl } from "./scaleCalibration.js";
import { CapabilityError } from "./types.js";

export type Vec3 = readonly [number, number, number];

interface Pt2 {
  x: number;
  y: number;
}

const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;
/** Normal directions within this angle are treated as the same surface. */
const NORMAL_CLUSTER_COS = Math.cos((8 * Math.PI) / 180);
/** A cluster smaller than this share of total surface area is noise, not a reference sheet. */
const MIN_CLUSTER_AREA_SHARE = 0.005;
/** Cap on planes examined per mesh, bounding worst-case cost on organic scans. */
const MAX_CLUSTERS_EXAMINED = 24;

export interface ReferenceSpec {
  id: string;
  label: string;
  /** Long edge in millimetres — this is the number handed to scale calibration. */
  longMm: number;
  shortMm: number;
  /** longMm / shortMm, the ratio the detector matches against. */
  aspect: number;
}

/**
 * Physical references we can recognise by shape alone.
 *
 * Only sizes that are defined by a standard belong here: a "roughly A4" sheet is not a
 * reference, it is a guess with paperwork.
 */
export const REFERENCE_SPECS: Record<string, ReferenceSpec> = {
  a4: {
    id: "a4",
    label: "A4 sheet (297 x 210 mm, ISO 216)",
    longMm: 297,
    shortMm: 210,
    aspect: 297 / 210,
  },
  card: {
    id: "card",
    label: "Bank / ID card (85.60 x 53.98 mm, ISO/IEC 7810 ID-1)",
    longMm: 85.6,
    shortMm: 53.98,
    aspect: 85.6 / 53.98,
  },
};

export interface MeshTriangle {
  vertices: [Vec3, Vec3, Vec3];
  normal: Vec3;
  area: number;
}

export interface DetectorOptions {
  /** Relative aspect-ratio error still accepted as "this is that reference". */
  aspectTolerance?: number;
  /**
   * Minimum fraction of the rectangle that the cluster must actually cover.
   *
   * Kept for diagnostics only: a real photogrammetry reconstruction of a flat sheet comes back
   * with holes and frayed edges, so `fill` routinely lands far below 1.0 even when the sheet's
   * outline is fully recovered. Gating on it would reject every real scan. Use
   * `minEdgeSupport` to judge whether the rectangle is actually bounded.
   */
  minFill?: number;
  /**
   * Minimum convex-hull area as a share of the bounding rectangle. This is the gate that
   * matters: a reconstruction hollows out the middle of a sheet without touching its convex
   * hull, so `fill` collapses while this stays at 1.0; an occluded or merged cluster instead
   * dents the hull, and this drops. */
  minOutlineFill?: number;
  /** Max RMS distance of cluster vertices from the fitted plane, as a share of long edge. */
  maxPlanarityRatio?: number;
  /** Minimum long-edge length as a share of the mesh's own bounding diagonal. */
  minScaleRatio?: number;
  /**
   * How far off a cluster's plane a triangle may sit and still join it, as a share of the mesh
   * bounding diagonal. Too tight and a slightly warped sheet shatters into fragments; too loose
   * and a parallel surface meters away is swallowed.
   */
  planeOffsetTolerance?: number;
}

const DEFAULTS: Required<DetectorOptions> = {
  aspectTolerance: 0.05,
  minFill: 0.85,
  minOutlineFill: 0.95,
  maxPlanarityRatio: 0.03,
  minScaleRatio: 0.05,
  planeOffsetTolerance: 0.015,
};

export interface ReferenceCandidate {
  specId: string;
  specLabel: string;
  /** Aspect ratio measured on the mesh. */
  aspect: number;
  /** |aspect - spec.aspect| / spec.aspect */
  aspectError: number;
  /** Cluster coverage of its own bounding rectangle, 0..1. Diagnostic: real scans have holes. */
  fill: number;
  /**
   * Convex-hull area as a share of the bounding rectangle, 0..1. Unaffected by holes in the
   * middle of a sheet, dented by an occluded outline. This is the gate.
   */
  outlineFill: number;
  /** Flatness: RMS out-of-plane deviation / long edge. */
  planarity: number;
  /** Long edge length in mesh units. */
  longEdge: number;
  /** Short edge length in mesh units. */
  shortEdge: number;
  /** Long edge / mesh bounding diagonal — how much of the model the sheet spans. */
  scaleRatio: number;
  /** Long edge endpoints in mesh coordinates, for a two_point scale reference. */
  longEdgePoints: [Vec3, Vec3];
  /** Rectangle corners in mesh coordinates, long edge first. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Planned millimetres per mesh unit. */
  mmPerUnit: number;
  /** 0..1, higher is a better match. */
  confidence: number;
  accepted: boolean;
  rejectedBy: string[];
}

export interface DetectionResult {
  triangles: number;
  /** Bounding diagonal of the whole mesh, in mesh units. */
  meshDiagonal: number;
  /** Every plane cluster examined, best-first: the good ones and the near-misses. */
  candidates: ReferenceCandidate[];
  /** Best candidate that passed every gate, if any. */
  best?: ReferenceCandidate;
  /** Closest miss, useful for explaining a failed shot. */
  closest?: ReferenceCandidate;
}

// --- small vector helpers -------------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));
function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

// --- STL reading ----------------------------------------------------------------------

export function readStlTriangles(buffer: Buffer): MeshTriangle[] {
  if (!isBinaryStl(buffer)) {
    throw new CapabilityError(
      "REFERENCE_DETECTION_UNSUPPORTED",
      "Reference detection supports binary STL only; the reconstructed mesh is in another encoding.",
      422
    );
  }
  const count = buffer.readUInt32LE(80);
  const triangles: MeshTriangle[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const base = HEADER_BYTES + i * TRIANGLE_BYTES;
    const nx = buffer.readFloatLE(base);
    const ny = buffer.readFloatLE(base + 4);
    const nz = buffer.readFloatLE(base + 8);
    const vertices: [Vec3, Vec3, Vec3] = [
      [
        buffer.readFloatLE(base + 12),
        buffer.readFloatLE(base + 16),
        buffer.readFloatLE(base + 20),
      ],
      [
        buffer.readFloatLE(base + 24),
        buffer.readFloatLE(base + 28),
        buffer.readFloatLE(base + 32),
      ],
      [
        buffer.readFloatLE(base + 36),
        buffer.readFloatLE(base + 40),
        buffer.readFloatLE(base + 44),
      ],
    ];
    // The stored normal is written by the engine and can be stale or zero; geometry wins.
    const geometric = cross(
      sub(vertices[1], vertices[0]),
      sub(vertices[2], vertices[0])
    );
    const area = len(geometric) / 2;
    const normal =
      len(geometric) > 0
        ? normalize(geometric)
        : normalize([nx, ny, nz] as Vec3);
    triangles[i] = { vertices, normal, area };
  }
  return triangles;
}

// --- 2D geometry ----------------------------------------------------------------------

function toPlaneFrame(point: Vec3, origin: Vec3, u: Vec3, v: Vec3): Pt2 {
  const d = sub(point, origin);
  return { x: dot(d, u), y: dot(d, v) };
}

/** Andrew's monotone chain; returns counter-clockwise hull, collinear points dropped. */
function convexHull(points: Pt2[]): Pt2[] {
  if (points.length <= 2) return points.slice();
  const sorted = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const crossZ = (o: Pt2, a: Pt2, b: Pt2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (input: Pt2[]): Pt2[] => {
    const out: Pt2[] = [];
    for (const p of input) {
      while (
        out.length >= 2 &&
        crossZ(out[out.length - 2], out[out.length - 1], p) <= 0
      )
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build(sorted.slice().reverse())];
}

interface Rect2 {
  corners: [Pt2, Pt2, Pt2, Pt2];
  longSide: number;
  shortSide: number;
  area: number;
}

/** Rotating calipers: the minimum-area rectangle enclosing a convex hull. */
function minAreaRect(hull: Pt2[]): Rect2 | null {
  if (hull.length < 3) return null;
  let best: Rect2 | null = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    let ex = b.x - a.x;
    let ey = b.y - a.y;
    const edge = Math.hypot(ex, ey);
    if (edge < 1e-12) continue;
    ex /= edge;
    ey /= edge;
    // Frame: u along the edge, v perpendicular to it.
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const pu = p.x * ex + p.y * ey;
      const pv = -p.x * ey + p.y * ex;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const width = maxU - minU;
    const height = maxV - minV;
    const area = width * height;
    if (!best || area < best.area) {
      const at = (u: number, v: number): Pt2 => ({
        x: u * ex - v * ey,
        y: u * ey + v * ex,
      });
      const corners: [Pt2, Pt2, Pt2, Pt2] = [
        at(minU, minV),
        at(maxU, minV),
        at(maxU, maxV),
        at(minU, maxV),
      ];
      best = {
        corners,
        longSide: Math.max(width, height),
        shortSide: Math.min(width, height),
        area,
      };
    }
  }
  return best;
}

// --- plane clustering -----------------------------------------------------------------

interface PlaneCluster {
  normalSum: Vec3;
  areaWeight: number;
  area: number;
  /** Area-weighted mean of dot(centroid, clusterNormal): which of the parallel planes this is. */
  offsetSum: number;
  points: Vec3[];
}

export function detectReference(
  buffer: Buffer,
  options: DetectorOptions = {}
): DetectionResult {
  const opts = { ...DEFAULTS, ...options };
  const triangles = readStlTriangles(buffer);
  if (triangles.length === 0) {
    throw new CapabilityError(
      "REFERENCE_DETECTION_UNSUPPORTED",
      "The mesh contains no triangles, so there is nothing to measure a reference against.",
      422
    );
  }

  let minAll: [number, number, number] = [Infinity, Infinity, Infinity];
  let maxAll: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let totalArea = 0;
  for (const t of triangles) {
    totalArea += t.area;
    for (const p of t.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (p[axis] < minAll[axis]) minAll[axis] = p[axis];
        if (p[axis] > maxAll[axis]) maxAll[axis] = p[axis];
      }
    }
  }
  const meshDiagonal = len([
    maxAll[0] - minAll[0],
    maxAll[1] - minAll[1],
    maxAll[2] - minAll[2],
  ] as Vec3);

  // Greedy coplanar clustering. Direction alone is not enough: a sphere's polar cap and a
  // sheet lying beside it share a normal, and merging them would inflate the sheet's bounding
  // rectangle past recognition. Each cluster therefore also tracks *which* parallel plane it
  // belongs to, and a triangle joins only if it sits on that plane.
  const planeOffsetTolerance = meshDiagonal * opts.planeOffsetTolerance;
  const clusters: PlaneCluster[] = [];
  const ordered = triangles.slice().sort((a, b) => b.area - a.area);
  for (const t of ordered) {
    const centroid: Vec3 = [
      (t.vertices[0][0] + t.vertices[1][0] + t.vertices[2][0]) / 3,
      (t.vertices[0][1] + t.vertices[1][1] + t.vertices[2][1]) / 3,
      (t.vertices[0][2] + t.vertices[1][2] + t.vertices[2][2]) / 3,
    ];
    let target: PlaneCluster | undefined;
    let bestScore = -Infinity;
    for (const c of clusters) {
      const candidateNormal = normalize(c.normalSum as Vec3);
      const alignment = dot(candidateNormal, t.normal);
      if (alignment <= NORMAL_CLUSTER_COS) continue;
      const clusterOffset = c.areaWeight > 0 ? c.offsetSum / c.areaWeight : 0;
      const offsetGap = Math.abs(
        dot(centroid, candidateNormal) - clusterOffset
      );
      if (offsetGap > planeOffsetTolerance) continue;
      // Prefer the closest plane among the aligned candidates.
      const score =
        alignment - offsetGap / Math.max(planeOffsetTolerance, 1e-12);
      if (score > bestScore) {
        bestScore = score;
        target = c;
      }
    }
    if (!target) {
      target = {
        normalSum: [0, 0, 0],
        areaWeight: 0,
        area: 0,
        offsetSum: 0,
        points: [],
      };
      clusters.push(target);
    }
    target.normalSum = [
      target.normalSum[0] + t.normal[0] * t.area,
      target.normalSum[1] + t.normal[1] * t.area,
      target.normalSum[2] + t.normal[2] * t.area,
    ];
    target.areaWeight += t.area;
    target.area += t.area;
    target.offsetSum +=
      dot(centroid, normalize(target.normalSum as Vec3)) * t.area;
    target.points.push(t.vertices[0], t.vertices[1], t.vertices[2]);
  }

  const candidates: ReferenceCandidate[] = [];
  const specs = Object.values(REFERENCE_SPECS);

  // Examine the largest planes; even a mesh that is all subject keeps its biggest plane for
  // diagnosis, because "why did this fail" is answerable only with numbers.
  const rankedClusters = clusters
    .slice()
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_CLUSTERS_EXAMINED);
  for (const cluster of rankedClusters) {
    const tooSmall = cluster.area < totalArea * MIN_CLUSTER_AREA_SHARE;
    if (tooSmall && cluster !== rankedClusters[0]) continue;
    if (cluster.points.length < 3) continue;

    const normal = normalize(cluster.normalSum as Vec3);
    if (len(normal) === 0) continue;

    // Plane origin: area-weighted centroid of the cluster's vertices.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of cluster.points) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const n = cluster.points.length;
    const origin: Vec3 = [cx / n, cy / n, cz / n];

    // Orthonormal frame on the plane.
    const helper: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(normal, helper));
    const v = normalize(cross(normal, u));
    if (len(u) === 0 || len(v) === 0) continue;

    let sq = 0;
    const flat: Pt2[] = new Array(cluster.points.length);
    for (let i = 0; i < cluster.points.length; i += 1) {
      const p = cluster.points[i];
      const d = dot(sub(p, origin), normal);
      sq += d * d;
      flat[i] = toPlaneFrame(p, origin, u, v);
    }
    const rms = Math.sqrt(sq / n);

    const hull = convexHull(flat);
    // Fit once roughly to learn the scale, simplify away outline spurs, then fit again.
    const rough = minAreaRect(hull);
    const rect =
      rough && rough.longSide > 0
        ? minAreaRect(simplifyClosedPolygon(hull, rough.longSide * 0.03)) ?? rough
        : rough;
    if (!rect || rect.area <= 0 || rect.shortSide <= 0) continue;

    const longSide = rect.longSide;
    const shortSide = rect.shortSide;
    const aspect = longSide / shortSide;
    // Cluster surface area / rectangle area: 1.0 for a sheet, ~0.785 for a disc, lower for
    // ragged or perforated reconstructions.
    const fill = Math.min(1, cluster.area / rect.area);
    const planarity = rms / longSide;
    const scaleRatio = longSide / meshDiagonal;

    // Which rectangle corners sit on the long edge? Compare the two candidate edge lengths.
    const cornerDist = (a: Pt2, b: Pt2) => Math.hypot(a.x - b.x, a.y - b.y);
    const edge01 = cornerDist(rect.corners[0], rect.corners[1]);
    const edge12 = cornerDist(rect.corners[1], rect.corners[2]);
    const longPair: [Pt2, Pt2] =
      edge01 >= edge12
        ? [rect.corners[0], rect.corners[1]]
        : [rect.corners[1], rect.corners[2]];

    const toWorld = (p: Pt2): Vec3 => [
      origin[0] + u[0] * p.x + v[0] * p.y,
      origin[1] + u[1] * p.x + v[1] * p.y,
      origin[2] + u[2] * p.x + v[2] * p.y,
    ];
    const longEdgePoints: [Vec3, Vec3] = [
      toWorld(longPair[0]),
      toWorld(longPair[1]),
    ];
    const corners: [Vec3, Vec3, Vec3, Vec3] = [
      toWorld(rect.corners[0]),
      toWorld(rect.corners[1]),
      toWorld(rect.corners[2]),
      toWorld(rect.corners[3]),
    ];

    // Holes in the middle of a reconstruction leave the hull intact; an occluded outline dents
    // it. Comparing hull area against the rectangle separates the two where `fill` cannot.
    const outlineFill = Math.min(1, Math.abs(polygonArea(hull)) / rect.area);

    for (const spec of specs) {
      const aspectError = Math.abs(aspect - spec.aspect) / spec.aspect;
      const rejectedBy: string[] = [];
      if (aspectError > opts.aspectTolerance) rejectedBy.push("aspect");
      if (outlineFill < opts.minOutlineFill) rejectedBy.push("outline");
      if (planarity > opts.maxPlanarityRatio) rejectedBy.push("planarity");
      if (scaleRatio < opts.minScaleRatio) rejectedBy.push("size");

      const confidence = Math.max(
        0,
        Math.min(
          1,
          (1 - Math.min(1, aspectError / opts.aspectTolerance)) * 0.45 +
            outlineFill * 0.35 +
            (1 - Math.min(1, planarity / opts.maxPlanarityRatio)) * 0.2
        )
      );

      candidates.push({
        specId: spec.id,
        specLabel: spec.label,
        aspect,
        aspectError,
        fill,
        outlineFill,
        planarity,
        longEdge: longSide,
        shortEdge: shortSide,
        scaleRatio,
        longEdgePoints,
        corners,
        mmPerUnit: spec.longMm / longSide,
        confidence,
        accepted: rejectedBy.length === 0,
        rejectedBy,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
    return b.confidence - a.confidence;
  });

  const best = candidates.find(c => c.accepted);
  // Closest miss by aspect error, which is what a human can act on ("your sheet looked 1.9:1").
  const closest = candidates
    .slice()
    .sort((a, b) => a.aspectError - b.aspectError)[0];

  return {
    triangles: triangles.length,
    meshDiagonal,
    candidates,
    best,
    closest,
  };
}

/** Shoelace area of a closed polygon, counter-clockwise or not. */
function polygonArea(poly: Pt2[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Distance from a point to a segment, used by the polygon simplifier. */
function pointSegmentDistance(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker simplification for a closed polygon, split at its two farthest points.
 *
 * A reconstruction's outline is ragged: stray triangles push the convex hull out by a few
 * millimetres at random spots. Fitting a rectangle straight to that hull tilts it, which skews
 * the aspect ratio and therefore the millimetre scale — a 297 mm sheet comes out as 285 mm.
 * Simplifying first drops those spurs while keeping the real corners, because a corner deviates
 * from the chord far more than the tolerance.
 */
function simplifyClosedPolygon(poly: Pt2[], tol: number): Pt2[] {
  if (poly.length < 4 || tol <= 0) return poly;
  let farA = 0;
  let farB = 0;
  let best = -1;
  for (let i = 0; i < poly.length; i += 1) {
    for (let j = i + 1; j < poly.length; j += 1) {
      const d = (poly[i].x - poly[j].x) ** 2 + (poly[i].y - poly[j].y) ** 2;
      if (d > best) {
        best = d;
        farA = i;
        farB = j;
      }
    }
  }
  const chain = (from: number, to: number): Pt2[] => {
    const out: Pt2[] = [];
    let i = from;
    for (let guard = 0; guard <= poly.length; guard += 1) {
      out.push(poly[i]);
      if (i === to) break;
      i = (i + 1) % poly.length;
    }
    return out;
  };
  const rdp = (pts: Pt2[]): Pt2[] => {
    if (pts.length < 3) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    let idx = -1;
    let maxD = -1;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const d = pointSegmentDistance(pts[i], a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx < 0 || maxD <= tol) return [a, b];
    const left = rdp(pts.slice(0, idx + 1));
    const right = rdp(pts.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  const first = rdp(chain(farA, farB));
  const second = rdp(chain(farB, farA));
  const merged = [...first.slice(0, -1), ...second.slice(0, -1)];
  return merged.length >= 3 ? merged : poly;
}
