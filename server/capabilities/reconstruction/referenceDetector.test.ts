/**
 * Tests for reference-object detection.
 *
 * The synthetic meshes here are built in mesh units with a *known* mm-per-unit, which is the
 * only way to prove the detector returns the truth rather than something self-consistent.
 */
import { describe, expect, it } from "vitest";

import { REFERENCE_SPECS, detectReference } from "./referenceDetector.js";
import type { Vec3 } from "./referenceDetector.js";

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

/** Minimal binary STL writer: header, count, then 50 bytes per triangle. */
function toStl(triangles: Tri[]): Buffer {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((t, i) => {
    const base = 84 + i * 50;
    // Normals are intentionally left at 0: the detector must derive them from geometry.
    for (const [v, p] of [
      [0, t.a],
      [1, t.b],
      [2, t.c],
    ] as const) {
      buffer.writeFloatLE(p[0], base + 12 + v * 12);
      buffer.writeFloatLE(p[1], base + 16 + v * 12);
      buffer.writeFloatLE(p[2], base + 20 + v * 12);
    }
  });
  return buffer;
}

/** A flat rectangle in the z=z0 plane, centred at (cx, cy), split into a triangle grid. */
function rectSheet(
  longEdge: number,
  shortEdge: number,
  opts: {
    cx?: number;
    cy?: number;
    z0?: number;
    divisions?: number;
    doubleSided?: boolean;
  } = {}
): Tri[] {
  const { cx = 0, cy = 0, z0 = 0, divisions = 12, doubleSided = false } = opts;
  const out: Tri[] = [];
  const halfL = longEdge / 2;
  const halfS = shortEdge / 2;
  const stepX = longEdge / divisions;
  const stepY = shortEdge / divisions;
  for (let i = 0; i < divisions; i += 1) {
    for (let j = 0; j < divisions; j += 1) {
      const x0 = cx - halfL + i * stepX;
      const x1 = x0 + stepX;
      const y0 = cy - halfS + j * stepY;
      const y1 = y0 + stepY;
      const p00: Vec3 = [x0, y0, z0];
      const p10: Vec3 = [x1, y0, z0];
      const p11: Vec3 = [x1, y1, z0];
      const p01: Vec3 = [x0, y1, z0];
      out.push({ a: p00, b: p10, c: p11 }, { a: p00, b: p11, c: p01 });
      if (doubleSided) {
        // Same sheet seen from below — real reconstructions give a sheet two faces.
        const p00b: Vec3 = [x0, y0, z0 - 0.02];
        const p10b: Vec3 = [x1, y0, z0 - 0.02];
        const p11b: Vec3 = [x1, y1, z0 - 0.02];
        const p01b: Vec3 = [x0, y1, z0 - 0.02];
        out.push({ a: p00b, b: p11b, c: p10b }, { a: p00b, b: p01b, c: p11b });
      }
    }
  }
  return out;
}

/** A sphere as a UV mesh — the "organic subject" that must never be mistaken for a sheet. */
function sphere(radius: number, centre: Vec3, lat = 16, lon = 24): Tri[] {
  const out: Tri[] = [];
  const at = (theta: number, phi: number): Vec3 => [
    centre[0] + radius * Math.sin(theta) * Math.cos(phi),
    centre[1] + radius * Math.sin(theta) * Math.sin(phi),
    centre[2] + radius * Math.cos(theta),
  ];
  for (let i = 0; i < lat; i += 1) {
    const t0 = (Math.PI * i) / lat;
    const t1 = (Math.PI * (i + 1)) / lat;
    for (let j = 0; j < lon; j += 1) {
      const p0 = (2 * Math.PI * j) / lon;
      const p1 = (2 * Math.PI * (j + 1)) / lon;
      out.push(
        { a: at(t0, p0), b: at(t1, p0), c: at(t1, p1) },
        { a: at(t0, p0), b: at(t1, p1), c: at(t0, p1) }
      );
    }
  }
  return out;
}

describe("reference detection", () => {
  it("recovers mm-per-unit from an A4 sheet beside a subject", () => {
    // Ground truth: one mesh unit is 13.7 mm. The mesh knows nothing about millimetres; the
    // detector must rebuild that number from the sheet's shape alone.
    const mmPerUnit = 13.7;
    const a4 = REFERENCE_SPECS.a4;
    const sheet = rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit, {
      z0: 0,
    });
    const subject = sphere(4, [0, 0, 4]);
    const result = detectReference(toStl([...sheet, ...subject]));

    expect(result.best).toBeDefined();
    expect(result.best?.specId).toBe("a4");
    expect(result.best?.mmPerUnit).toBeCloseTo(mmPerUnit, 2);
    expect(result.best?.fill).toBeGreaterThan(0.98);
  });

  it("distinguishes a bank card from an A4 sheet by aspect ratio", () => {
    const mmPerUnit = 5;
    const card = REFERENCE_SPECS.card;
    const mesh = rectSheet(card.longMm / mmPerUnit, card.shortMm / mmPerUnit);
    const result = detectReference(toStl(mesh));

    expect(result.best?.specId).toBe("card");
    expect(result.best?.mmPerUnit).toBeCloseTo(mmPerUnit, 2);
  });

  it("still measures a sheet that reconstruction gave two faces", () => {
    const mmPerUnit = 8;
    const a4 = REFERENCE_SPECS.a4;
    const mesh = rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit, {
      doubleSided: true,
    });
    const result = detectReference(toStl(mesh));

    expect(result.best?.specId).toBe("a4");
    expect(result.best?.mmPerUnit).toBeCloseTo(mmPerUnit, 2);
  });

  it("refuses to call a sphere a reference, and says why", () => {
    const result = detectReference(toStl(sphere(10, [0, 0, 0])));

    expect(result.best).toBeUndefined();
    expect(result.closest).toBeDefined();
    // A sphere's projected coverage is ~pi/4, i.e. it fails the fill gate, not the aspect one.
    expect(result.closest?.fill).toBeLessThan(0.9);
  });

  it("rejects a sheet whose proportions match no physical standard", () => {
    // 2:1 is neither A4 (1.414) nor ID-1 (1.586). A plausible-looking wrong factor is the
    // failure mode this gate exists to prevent.
    const result = detectReference(toStl(rectSheet(40, 20)));

    expect(result.best).toBeUndefined();
    expect(result.closest?.aspectError).toBeGreaterThan(0.2);
  });

  it("reports the long-edge endpoints in mesh coordinates for two_point calibration", () => {
    const mmPerUnit = 10;
    const a4 = REFERENCE_SPECS.a4;
    const result = detectReference(
      toStl(rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit))
    );

    const points = result.best!.longEdgePoints;
    const dx = points[0][0] - points[1][0];
    const dy = points[0][1] - points[1][1];
    const dz = points[0][2] - points[1][2];
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(a4.longMm / mmPerUnit, 2);
  });
});
