/**
 * Local verification runner for reference detection.
 *
 * vitest cannot start on this machine (rollup's native binary fails codesign), so the same
 * assertions are executed through tsx to prove the detector's numbers before it is wired into
 * a CLI. The vitest suite next to the detector remains the canonical test.
 */
import assert from "node:assert/strict";

import {
  REFERENCE_SPECS,
  detectReference,
} from "../server/capabilities/reconstruction/referenceDetector.js";
import type { Vec3 } from "../server/capabilities/reconstruction/referenceDetector.js";

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function toStl(triangles: Tri[]): Buffer {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((t, i) => {
    const base = 84 + i * 50;
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

function rectSheet(
  longEdge: number,
  shortEdge: number,
  opts: { z0?: number; divisions?: number; doubleSided?: boolean } = {}
): Tri[] {
  const { z0 = 0, divisions = 12, doubleSided = false } = opts;
  const out: Tri[] = [];
  const halfL = longEdge / 2;
  const halfS = shortEdge / 2;
  const stepX = longEdge / divisions;
  const stepY = shortEdge / divisions;
  for (let i = 0; i < divisions; i += 1) {
    for (let j = 0; j < divisions; j += 1) {
      const x0 = -halfL + i * stepX;
      const x1 = x0 + stepX;
      const y0 = -halfS + j * stepY;
      const y1 = y0 + stepY;
      const p00: Vec3 = [x0, y0, z0];
      const p10: Vec3 = [x1, y0, z0];
      const p11: Vec3 = [x1, y1, z0];
      const p01: Vec3 = [x0, y1, z0];
      out.push({ a: p00, b: p10, c: p11 }, { a: p00, b: p11, c: p01 });
      if (doubleSided) {
        const z1 = z0 - 0.02;
        const q00: Vec3 = [x0, y0, z1];
        const q10: Vec3 = [x1, y0, z1];
        const q11: Vec3 = [x1, y1, z1];
        const q01: Vec3 = [x0, y1, z1];
        out.push({ a: q00, b: q11, c: q10 }, { a: q00, b: q01, c: q11 });
      }
    }
  }
  return out;
}

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

const near = (actual: number, expected: number, tol: number, label: string) => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ~${expected}, got ${actual} (tol ${tol})`
  );
  console.log(`  ok   ${label}: ${actual.toFixed(3)} (expected ~${expected})`);
};

// 1. A4 beside a subject, ground truth 13.7 mm per unit.
{
  const mmPerUnit = 13.7;
  const a4 = REFERENCE_SPECS.a4;
  const mesh = [
    ...rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit),
    ...sphere(4, [0, 0, 4]),
  ];
  const r = detectReference(toStl(mesh));
  console.log("[1] A4 + sphere subject");
  assert.equal(
    r.best?.specId,
    "a4",
    `expected a4, got ${r.best?.specId ?? "none"}`
  );
  near(r.best!.mmPerUnit, mmPerUnit, 0.05, "mm/unit");
  assert.ok(r.best!.fill > 0.98, `fill ${r.best!.fill}`);
  console.log(
    `  ok   fill ${r.best!.fill.toFixed(4)}, confidence ${r.best!.confidence.toFixed(3)}`
  );
}

// 2. Bank card.
{
  const mmPerUnit = 5;
  const card = REFERENCE_SPECS.card;
  const r = detectReference(
    toStl(rectSheet(card.longMm / mmPerUnit, card.shortMm / mmPerUnit))
  );
  console.log("[2] bank card");
  assert.equal(r.best?.specId, "card");
  near(r.best!.mmPerUnit, mmPerUnit, 0.05, "mm/unit");
}

// 3. Two-faced sheet (what photogrammetry actually produces).
{
  const mmPerUnit = 8;
  const a4 = REFERENCE_SPECS.a4;
  const mesh = rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit, {
    doubleSided: true,
  });
  const r = detectReference(toStl(mesh));
  console.log("[3] double-sided sheet");
  assert.equal(r.best?.specId, "a4");
  near(r.best!.mmPerUnit, mmPerUnit, 0.05, "mm/unit");
}

// 4. Sphere only: must not invent a reference.
{
  const r = detectReference(toStl(sphere(10, [0, 0, 0])));
  console.log("[4] sphere only (no reference)");
  assert.equal(r.best, undefined, "sphere must not be accepted as a reference");
  assert.ok(r.closest, "a closest miss should be reported for diagnosis");
  console.log(
    `  ok   closest: aspect ${r.closest!.aspect.toFixed(3)}, fill ${r.closest!.fill.toFixed(3)}`
  );
}

// 5. 2:1 sheet matches no standard.
{
  const r = detectReference(toStl(rectSheet(40, 20)));
  console.log("[5] 2:1 rectangle");
  assert.equal(r.best, undefined, "2:1 must not be accepted");
  assert.ok(
    r.closest!.aspectError > 0.2,
    `aspectError ${r.closest!.aspectError}`
  );
  console.log(
    `  ok   aspectError ${(r.closest!.aspectError * 100).toFixed(1)}%`
  );
}

// 6. Long-edge endpoints measure the true long edge.
{
  const mmPerUnit = 10;
  const a4 = REFERENCE_SPECS.a4;
  const r = detectReference(
    toStl(rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit))
  );
  const [p, q] = r.best!.longEdgePoints;
  const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  console.log("[6] two_point endpoints");
  near(d, a4.longMm / mmPerUnit, 0.02, "long edge in mesh units");
}

// 7. Tilted sheet: the reference will not be axis-aligned in a real shot.
{
  const mmPerUnit = 9;
  const a4 = REFERENCE_SPECS.a4;
  const tilt = (t: Tri): Tri => {
    const rot = (p: Vec3): Vec3 => [
      p[0],
      p[1] * Math.cos(0.6) - p[2] * Math.sin(0.6),
      p[1] * Math.sin(0.6) + p[2] * Math.cos(0.6),
    ];
    return { a: rot(t.a), b: rot(t.b), c: rot(t.c) };
  };
  const mesh = rectSheet(a4.longMm / mmPerUnit, a4.shortMm / mmPerUnit).map(
    tilt
  );
  const r = detectReference(toStl(mesh));
  console.log("[7] tilted sheet (34 deg)");
  assert.ok(
    r.best,
    `tilted sheet not detected (closest aspect ${r.closest?.aspect.toFixed(3)}, fill ${r.closest?.fill.toFixed(3)})`
  );
  near(r.best!.mmPerUnit, mmPerUnit, 0.1, "mm/unit");
}

console.log("\nall detector checks passed");
