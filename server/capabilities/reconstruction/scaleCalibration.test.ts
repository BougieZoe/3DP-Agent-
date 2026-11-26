import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyScaleReferenceToStlFile,
  isBinaryStl,
  measureStl,
  resolveScaleFactor,
  scaleStlBuffer,
  SUPPORTED_SCALE_KINDS,
} from "./scaleCalibration.js";
import { CapabilityError } from "./types.js";

/** Minimal binary STL for a box, in whatever units the engine happened to choose. */
function boxStl(sx: number, sy: number, sz: number): Buffer {
  const corners: Array<[number, number, number]> = [
    [0, 0, 0],
    [sx, 0, 0],
    [sx, sy, 0],
    [0, sy, 0],
    [0, 0, sz],
    [sx, 0, sz],
    [sx, sy, sz],
    [0, sy, sz],
  ];
  const faces: Array<[number, number, number]> = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3],
    [3, 7, 4], [3, 4, 0],
  ];
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.writeUInt32LE(faces.length, 80);
  faces.forEach((face, faceIndex) => {
    const base = 84 + faceIndex * 50;
    face.forEach((cornerIndex, vertexIndex) => {
      const corner = corners[cornerIndex];
      const offset = base + 12 + vertexIndex * 12;
      buffer.writeFloatLE(corner[0], offset);
      buffer.writeFloatLE(corner[1], offset + 4);
      buffer.writeFloatLE(corner[2], offset + 8);
    });
  });
  return buffer;
}

function flatStl(): Buffer {
  // A single triangle in the z=0 plane: measurable in x/y, degenerate in z.
  const buffer = Buffer.alloc(84 + 50);
  buffer.writeUInt32LE(1, 80);
  const vertices = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  vertices.forEach((v, i) => {
    const offset = 84 + 12 + i * 12;
    buffer.writeFloatLE(v[0], offset);
    buffer.writeFloatLE(v[1], offset + 4);
    buffer.writeFloatLE(v[2], offset + 8);
  });
  return buffer;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof CapabilityError ? err.code : `NOT_CAPABILITY_ERROR:${(err as Error).name}`;
  }
  return "NO_THROW";
}

describe("binary STL handling", () => {
  it("detects binary STL and rejects ASCII payloads", () => {
    expect(isBinaryStl(boxStl(1, 2, 3))).toBe(true);
    expect(isBinaryStl(Buffer.from("solid part\nfacet normal 0 0 1\nendsolid\n", "utf8"))).toBe(false);
  });

  it("measures bounds and centre of the engine mesh", () => {
    const bounds = measureStl(boxStl(1, 2, 3));
    expect(bounds.size).toEqual([1, 2, 3]);
    expect(bounds.center).toEqual([0.5, 1, 1.5]);
    expect(bounds.triangles).toBe(12);
  });
});

describe("scale factor resolution", () => {
  it("uses the named axis extent for known_dimension", () => {
    const bounds = measureStl(boxStl(1, 2, 3));
    const { factor, measured_mm, source } = resolveScaleFactor(bounds, {
      kind: "known_dimension",
      known_mm: 100,
      axis: "x",
    });
    expect(measured_mm).toBe(1);
    expect(factor).toBe(100);
    expect(source).toBe("axis:x");
  });

  it("uses the point distance for two_point", () => {
    const bounds = measureStl(boxStl(1, 2, 3));
    const { factor, measured_mm, source } = resolveScaleFactor(bounds, {
      kind: "two_point",
      known_mm: 50,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
      ],
    });
    expect(measured_mm).toBe(2);
    expect(factor).toBe(25);
    expect(source).toBe("two_point");
  });

  it("refuses a reference it cannot measure against instead of guessing", () => {
    const bounds = measureStl(boxStl(1, 2, 3));
    expect(codeOf(() => resolveScaleFactor(bounds, { kind: "calibration_board", known_mm: 50 })))
      .toBe("SCALE_REFERENCE_UNSUPPORTED");
    expect(codeOf(() => resolveScaleFactor(bounds, { kind: "known_dimension", known_mm: 50 })))
      .toBe("SCALE_REFERENCE_INVALID");
    expect(
      codeOf(() =>
        resolveScaleFactor(bounds, {
          kind: "two_point",
          known_mm: 50,
          points: [
            { x: 1, y: 1, z: 1 },
            { x: 1, y: 1, z: 1 },
          ],
        }),
      ),
    ).toBe("SCALE_REFERENCE_INVALID");
    expect(codeOf(() => resolveScaleFactor(bounds, { kind: "known_dimension", known_mm: 0, axis: "x" })))
      .toBe("SCALE_REFERENCE_INVALID");
    expect(SUPPORTED_SCALE_KINDS).toEqual(["known_dimension", "two_point"]);
  });

  it("reports a degenerate extent rather than dividing by zero", () => {
    const bounds = measureStl(flatStl());
    expect(codeOf(() => resolveScaleFactor(bounds, { kind: "known_dimension", known_mm: 10, axis: "z" })))
      .toBe("SCALE_REFERENCE_DEGENERATE");
  });
});

describe("geometry scaling", () => {
  it("scales about the centre so the model does not drift", () => {
    const original = boxStl(1, 2, 3);
    const bounds = measureStl(original);
    const scaled = measureStl(scaleStlBuffer(original, 10, bounds.center));
    expect(scaled.size.map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 20, 30]);
    expect(scaled.center.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, 1, 1.5]);
  });

  it("calibrates the file and keeps the engine's own mesh for recovery", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scale-cal-"));
    const stlPath = path.join(dir, "mesh.stl");
    await fs.writeFile(stlPath, boxStl(0.37, 1.1, 2.2));

    const applied = await applyScaleReferenceToStlFile(stlPath, {
      kind: "known_dimension",
      known_mm: 74,
      axis: "y",
    });

    expect(applied.source).toBe("axis:y");
    expect(applied.known_mm).toBe(74);
    expect(applied.measured_mm).toBeCloseTo(1.1, 5);
    expect(applied.factor).toBeCloseTo(74 / 1.1, 5);

    const calibrated = measureStl(await fs.readFile(stlPath));
    expect(calibrated.size[1]).toBeCloseTo(74, 3);

    const backup = await fs.readFile(path.join(dir, "mesh.unscaled.stl"));
    expect(measureStl(backup).size[1]).toBeCloseTo(1.1, 5);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
