/**
 * PLY -> STL conversion tests.
 *
 * These run without COLMAP: the conversion is the part of the pipeline that can silently
 * corrupt geometry (wrong stride, dropped faces, unit confusion), so it gets its own
 * fixtures rather than being trusted because the engine "usually works".
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encodeBinaryStl, parsePly, plyFileToStl, scaleMesh } from "./ply.js";

const ASCII_PLY = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 2
property list uchar int vertex_indices
end_header
0 0 0
10 0 0
10 10 0
0 10 0
3 0 1 2
3 0 2 3
`;

const BINARY_PLY_VERTICES: Array<[number, number, number]> = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 10, 0],
  [0, 10, 0],
];
const BINARY_PLY_FACES: Array<[number, number, number]> = [
  [0, 1, 2],
  [0, 2, 3],
];

function buildBinaryPly(): Buffer {
  const header = Buffer.from(
    [
      "ply",
      "format binary_little_endian 1.0",
      `element vertex ${BINARY_PLY_VERTICES.length}`,
      "property float x",
      "property float y",
      "property float z",
      `element face ${BINARY_PLY_FACES.length}`,
      "property list uchar int vertex_indices",
      "end_header",
      "",
    ].join("\n"),
    "utf8",
  );
  const vertexBytes = Buffer.alloc(BINARY_PLY_VERTICES.length * 12);
  BINARY_PLY_VERTICES.forEach(([x, y, z], index) => {
    vertexBytes.writeFloatLE(x, index * 12);
    vertexBytes.writeFloatLE(y, index * 12 + 4);
    vertexBytes.writeFloatLE(z, index * 12 + 8);
  });
  const faceBytes = Buffer.alloc(BINARY_PLY_FACES.length * 13);
  BINARY_PLY_FACES.forEach((face, index) => {
    faceBytes.writeUInt8(3, index * 13);
    face.forEach((vertex, slot) => faceBytes.writeInt32LE(vertex, index * 13 + 1 + slot * 4));
  });
  return Buffer.concat([header, vertexBytes, faceBytes]);
}

describe("PLY parsing", () => {
  it("reads ASCII vertices and triangle faces", () => {
    const result = parsePly(Buffer.from(ASCII_PLY, "utf8"));
    expect(result.vertexCount).toBe(4);
    expect(result.mesh.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(result.mesh.vertices.slice(0, 3)).toEqual([0, 0, 0]);
    expect(result.mesh.vertices.slice(3, 6)).toEqual([10, 0, 0]);
  });

  it("reads binary little-endian meshes with the same result", () => {
    const result = parsePly(buildBinaryPly());
    expect(result.format).toBe("binary_little_endian");
    expect(result.vertexCount).toBe(4);
    expect(result.mesh.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(result.mesh.vertices.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("triangulates quads as a fan instead of dropping them", () => {
    const quad = ASCII_PLY.replace("3 0 1 2", "4 0 1 2 3").replace("3 0 2 3", "3 0 1 2");
    const result = parsePly(Buffer.from(quad, "utf8"));
    // 4-vertex face -> 2 triangles, plus the following triangle = 3 triangles.
    expect(result.mesh.indices.length / 3).toBe(3);
  });

  it("rejects a mesh with no faces instead of writing an empty STL", async () => {
    const empty = ASCII_PLY.replace("element face 2\nproperty list uchar int vertex_indices\nend_header", "end_header");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ply-test-"));
    const source = path.join(dir, "empty.ply");
    await fs.writeFile(source, empty, "utf8");
    await expect(plyFileToStl(source, path.join(dir, "empty.stl"))).rejects.toThrow(/no triangle faces/i);
  });
});

describe("STL encoding", () => {
  it("writes the binary STL header, count and payload size", () => {
    const stl = encodeBinaryStl({ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] });
    expect(stl.byteLength).toBe(84 + 50);
    expect(stl.readUInt32LE(80)).toBe(1);
  });

  it("normalises the facet normal", () => {
    const stl = encodeBinaryStl({
      vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0],
      indices: [0, 1, 2],
    });
    const nx = stl.readFloatLE(84);
    const ny = stl.readFloatLE(88);
    const nz = stl.readFloatLE(92);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
    expect(nz).toBeCloseTo(1, 5);
  });

  it("applies the unit scale to every coordinate", () => {
    const mesh = scaleMesh({ vertices: [1, 2, 3], indices: [] }, 25.4);
    expect(mesh.vertices[0]).toBeCloseTo(25.4, 5);
    expect(mesh.vertices[2]).toBeCloseTo(76.2, 5);
  });
});
