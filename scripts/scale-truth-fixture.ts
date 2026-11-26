/**
 * Builds synthetic meshes for exercising scripts/scale-truth.ts end to end.
 * Values are chosen so the expected millimetres-per-unit is known exactly.
 */
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: make-fixture.ts <outDir>");
fs.mkdirSync(outDir, { recursive: true });

type V = [number, number, number];

function toStl(tris: { a: V; b: V; c: V }[]): Buffer {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const base = 84 + i * 50;
    [t.a, t.b, t.c].forEach((p, v) => {
      buf.writeFloatLE(p[0], base + 12 + v * 12);
      buf.writeFloatLE(p[1], base + 16 + v * 12);
      buf.writeFloatLE(p[2], base + 20 + v * 12);
    });
  });
  return buf;
}

function rect(
  longEdge: number,
  shortEdge: number,
  z0 = 0,
  divisions = 12,
  offsetX = 0
) {
  const out: { a: V; b: V; c: V }[] = [];
  const sx = longEdge / divisions;
  const sy = shortEdge / divisions;
  for (let i = 0; i < divisions; i += 1) {
    for (let j = 0; j < divisions; j += 1) {
      const x0 = -longEdge / 2 + i * sx + offsetX;
      const x1 = x0 + sx;
      const y0 = -shortEdge / 2 + j * sy;
      const y1 = y0 + sy;
      out.push(
        { a: [x0, y0, z0], b: [x1, y0, z0], c: [x1, y1, z0] },
        { a: [x0, y0, z0], b: [x1, y1, z0], c: [x0, y1, z0] }
      );
    }
  }
  return out;
}

function sphere(radius: number, centre: V, lat = 16, lon = 24) {
  const out: { a: V; b: V; c: V }[] = [];
  const at = (t: number, p: number): V => [
    centre[0] + radius * Math.sin(t) * Math.cos(p),
    centre[1] + radius * Math.sin(t) * Math.sin(p),
    centre[2] + radius * Math.cos(t),
  ];
  for (let i = 0; i < lat; i += 1) {
    for (let j = 0; j < lon; j += 1) {
      const t0 = (Math.PI * i) / lat;
      const t1 = (Math.PI * (i + 1)) / lat;
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

/** A4 sheet beside a subject; ground truth 7.3 mm per mesh unit. */
const mmPerUnit = 7.3;
const a4Long = 297 / mmPerUnit;
const a4Short = 210 / mmPerUnit;
fs.writeFileSync(
  path.join(outDir, "a4-and-subject.stl"),
  toStl([...rect(a4Long, a4Short), ...sphere(5, [a4Long / 2 + 12, 0, 5])])
);

/** Same scene scaled 3x in mesh units: the detector must still recover 7.3 mm/unit. */
fs.writeFileSync(
  path.join(outDir, "a4-and-subject-scaled.stl"),
  toStl([
    ...rect(a4Long * 3, a4Short * 3),
    ...sphere(15, [(a4Long * 3) / 2 + 36, 0, 15]),
  ])
);

/** Subject only — must be refused. */
fs.writeFileSync(
  path.join(outDir, "subject-only.stl"),
  toStl(sphere(10, [0, 0, 0]))
);

/** A sheet whose proportions match nothing standard (2:1). */
fs.writeFileSync(path.join(outDir, "wrong-aspect.stl"), toStl(rect(60, 30)));

/** A4 partly covered by an object resting on it: the rectangle becomes an L shape. */
const heavy = rect(a4Long, a4Short);
const cover = rect(a4Long * 0.5, a4Short * 0.5, 0.5, 6, a4Long * 0.2);
fs.writeFileSync(
  path.join(outDir, "a4-occluded.stl"),
  toStl([...heavy, ...cover])
);

console.log(
  `wrote fixtures to ${outDir} (ground truth ${mmPerUnit} mm/unit for a4-and-subject*)`
);

// A4 with a third of it missing: an L shape in one plane. Must be rejected on fill.
{
  const full = rect(a4Long, a4Short);
  const keep = full.filter(t => {
    const cx = (t.a[0] + t.b[0] + t.c[0]) / 3;
    const cy = (t.a[1] + t.b[1] + t.c[1]) / 3;
    return !(cx > a4Long * 0.1 && cy > a4Short * 0.05); // carve the +x/+y quadrant
  });
  fs.writeFileSync(path.join(outDir, "a4-carved.stl"), toStl(keep));
  console.log(`a4-carved.stl: ${keep.length}/${full.length} triangles kept`);
}

// A4 lying on a much larger coplanar desk: the single most realistic way this goes wrong.
{
  const deskLong = 600;
  const deskShort = 400;
  fs.writeFileSync(
    path.join(outDir, "a4-on-coplanar-desk.stl"),
    toStl([
      ...rect(deskLong, deskShort),
      ...rect(a4Long, a4Short, 0, 12, deskLong * 0.15),
    ])
  );
  // Same desk, but the sheet lifted 1% of the diagonal above it, as a real sheet would be.
  fs.writeFileSync(
    path.join(outDir, "a4-lifted-on-desk.stl"),
    toStl([
      ...rect(deskLong, deskShort),
      ...rect(a4Long, a4Short, 0.6, 12, deskLong * 0.15),
    ])
  );
}
