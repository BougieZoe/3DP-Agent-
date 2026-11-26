/**
 * Scale calibration for reconstructed meshes.
 *
 * Every photogrammetry engine in v1 (Apple Object Capture, Meshroom/COLMAP) reconstructs up
 * to similarity: geometry is right, absolute size is arbitrary. There are exactly two honest
 * ways to fix that — scale the mesh against a length the caller knows, or hand back an
 * uncalibrated mesh and say so. This module implements the first and refuses to fake it when
 * the request cannot be measured.
 *
 * Design constraints (see docs/capability-open-standard-contract.md):
 * - Calibration is a geometry post-process, so it works for any provider and does not change
 *   what an engine is asked to do.
 * - The original mesh is kept next to the scaled one (`*.unscaled.stl`): a wrong `known_mm`
 *   from a caller must be recoverable without re-running a 5-minute reconstruction.
 * - Unsupported or unmeasurable references fail with a machine-readable code. A job is never
 *   reported succeeded with a silently unscaled-but-labelled-millimetre file.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { CapabilityError } from "./types.js";
import type { AppliedScale, ScaleReference } from "./types.js";

const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;
/** Below this the measured extent is numerical noise, not a dimension. */
const MIN_MEASURABLE_MM = 1e-6;

/**
 * How many millimetres one unit of `output.units` represents.
 *
 * `known_mm` is always millimetres (the request field says so), but the delivered mesh is
 * numbered in `output.units` — that is what the STEP exporter assumes when it converts to
 * millimetres, and what any caller reading raw vertex values will assume. Leaving the two
 * disconnected is how a part arrives 10x or 25.4x off while every field looks right.
 */
export const MM_PER_UNIT: Record<"mm" | "cm" | "in", number> = { mm: 1, cm: 10, in: 25.4 };

export const SUPPORTED_SCALE_KINDS = ["known_dimension", "two_point"] as const;

type Vec3 = readonly [number, number, number];

export interface StlBounds {
  min: Vec3;
  max: Vec3;
  /** Extent along each axis, in the mesh's own units. */
  size: Vec3;
  center: Vec3;
  triangles: number;
}

/** Binary STL detection by exact length match — ASCII STL must not be trivially mis-parsed. */
export function isBinaryStl(buffer: Buffer): boolean {
  if (buffer.length < HEADER_BYTES) return false;
  const triangles = buffer.readUInt32LE(80);
  return buffer.length === HEADER_BYTES + triangles * TRIANGLE_BYTES;
}

export function measureStl(buffer: Buffer): StlBounds {
  if (!isBinaryStl(buffer)) {
    throw new CapabilityError(
      "SCALE_REFERENCE_UNSUPPORTED",
      "Scale calibration currently supports binary STL only; the produced mesh is in another encoding.",
      422,
    );
  }
  const triangles = buffer.readUInt32LE(80);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < triangles; i += 1) {
    // Skip the 12-byte normal: scaling moves vertices only, normals are invariant.
    const base = HEADER_BYTES + i * TRIANGLE_BYTES + 12;
    for (let v = 0; v < 3; v += 1) {
      const offset = base + v * 12;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = buffer.readFloatLE(offset + axis * 4);
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  if (triangles === 0) {
    throw new CapabilityError(
      "SCALE_REFERENCE_UNSUPPORTED",
      "The reconstructed mesh contains no triangles, so there is no dimension to calibrate against.",
      422,
    );
  }

  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    triangles,
  };
}

/**
 * Scale every vertex about `center`, so the model grows in place instead of drifting away
 * from the origin the engine chose (which downstream bed-placement would inherit).
 */
export function scaleStlBuffer(buffer: Buffer, factor: number, center: Vec3): Buffer {
  const out = Buffer.from(buffer);
  const triangles = out.readUInt32LE(80);
  for (let i = 0; i < triangles; i += 1) {
    const base = HEADER_BYTES + i * TRIANGLE_BYTES + 12;
    for (let v = 0; v < 3; v += 1) {
      const offset = base + v * 12;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = out.readFloatLE(offset + axis * 4);
        out.writeFloatLE(center[axis] + (value - center[axis]) * factor, offset + axis * 4);
      }
    }
  }
  return out;
}

const AXIS_INDEX: Record<string, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

function assertKnownMm(ref: ScaleReference): void {
  if (!(typeof ref.known_mm === "number") || !Number.isFinite(ref.known_mm) || ref.known_mm <= 0) {
    throw new CapabilityError(
      "SCALE_REFERENCE_INVALID",
      "scale_reference.known_mm must be a positive, finite number of millimetres.",
      422,
    );
  }
}

/**
 * Resolve the reference into (measured span, factor) against the produced mesh.
 * Exported for tests and for providers that want to validate before spending minutes on
 * a reconstruction that could never be calibrated.
 */
export function resolveScaleFactor(
  bounds: StlBounds,
  ref: ScaleReference,
): { factor: number; measured_mm: number; source: string } {
  assertKnownMm(ref);

  let measured: number;
  let source: string;

  if (ref.kind === "known_dimension") {
    const axis = ref.axis;
    if (!axis || !(axis in AXIS_INDEX)) {
      throw new CapabilityError(
        "SCALE_REFERENCE_INVALID",
        'scale_reference.kind="known_dimension" requires axis ("x" | "y" | "z") naming the ' +
          "mesh extent that known_mm measures; without it the factor would be a guess.",
        422,
      );
    }
    measured = bounds.size[AXIS_INDEX[axis]];
    source = `axis:${axis}`;
  } else if (ref.kind === "two_point") {
    const points = ref.points;
    if (!Array.isArray(points) || points.length !== 2) {
      throw new CapabilityError(
        "SCALE_REFERENCE_INVALID",
        'scale_reference.kind="two_point" requires exactly two points.',
        422,
      );
    }
    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    measured = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(measured) || measured < MIN_MEASURABLE_MM) {
      throw new CapabilityError(
        "SCALE_REFERENCE_INVALID",
        "scale_reference.points are coincident; the distance between them is zero.",
        422,
      );
    }
    source = "two_point";
  } else {
    throw new CapabilityError(
      "SCALE_REFERENCE_UNSUPPORTED",
      `scale_reference.kind="${ref.kind}" is not supported in v1. Supported kinds: ` +
        `${SUPPORTED_SCALE_KINDS.join(", ")}. Marker-based boards are not detected yet, and ` +
        "guessing a board pose would hand back a wrongly-scaled part.",
      422,
    );
  }

  if (!Number.isFinite(measured) || measured < MIN_MEASURABLE_MM) {
    throw new CapabilityError(
      "SCALE_REFERENCE_DEGENERATE",
      `The mesh extent selected by scale_reference (${source}) is zero; no scale factor can be derived from it.`,
      422,
    );
  }

  return { factor: ref.known_mm / measured, measured_mm: measured, source };
}

/**
 * Apply a scale reference to an STL file in place, keeping the unscaled mesh alongside it.
 *
 * Returns the applied record for the job ledger. Callers must persist it: a mesh whose
 * provenance is unknown is exactly the "arbitrary scale" trap this capability exists to
 * remove.
 */
export async function applyScaleReferenceToStlFile(
  stlPath: string,
  ref: ScaleReference,
  units: "mm" | "cm" | "in" = "mm",
): Promise<AppliedScale> {
  const original = await fs.readFile(stlPath);
  const bounds = measureStl(original);
  const { factor, measured_mm, source } = resolveScaleFactor(bounds, ref);

  // Calibration answers "how big is this really"; `units` answers "in which numbers do we say
  // it". Both must be applied here, together, or the STEP exporter will re-scale a mesh it was
  // already told was already in `units`.
  const mmPerUnit = MM_PER_UNIT[units];
  const vertexFactor = factor / mmPerUnit;

  const scaled = scaleStlBuffer(original, vertexFactor, bounds.center);

  // Keep the engine's own numbers: a wrong known_mm must be recoverable without re-running
  // the reconstruction, and "I lost the original" is not an acceptable answer.
  const backupPath = path.join(
    path.dirname(stlPath),
    `${path.basename(stlPath, path.extname(stlPath))}.unscaled${path.extname(stlPath)}`,
  );
  await fs.writeFile(backupPath, original);

  // Write-then-rename so a crash mid-write cannot leave a truncated mesh in the output slot.
  const tmpPath = `${stlPath}.scaled.tmp`;
  await fs.writeFile(tmpPath, scaled);
  await fs.rename(tmpPath, stlPath);

  return {
    source,
    known_mm: ref.known_mm,
    measured_mm,
    units,
    factor: vertexFactor,
    applied_at: new Date().toISOString(),
  };
}
