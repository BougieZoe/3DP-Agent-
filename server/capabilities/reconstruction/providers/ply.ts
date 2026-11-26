/**
 * PLY -> STL conversion.
 *
 * COLMAP's meshers emit PLY; the contract speaks in open formats it actually lists
 * (`stl`, `glb`, `obj`, `3mf`, `step`). Rather than inventing a `ply` output format that
 * external callers never agreed to, meshes are converted to STL on the way out.
 *
 * Deliberately dependency-free and narrow: vertices plus triangle faces, ASCII and
 * binary little-endian. A PLY this cannot read is reported as a conversion failure instead
 * of being silently approximated.
 */
import fs from "node:fs/promises";

type PlyScalar = "char" | "uchar" | "int8" | "uint8" | "short" | "ushort" | "int16" | "uint16" | "int" | "uint" | "int32" | "uint32" | "float" | "float32" | "double" | "float64";

const SCALAR_BYTES: Record<PlyScalar, number> = {
  char: 1, int8: 1,
  uchar: 1, uint8: 1,
  short: 2, int16: 2,
  ushort: 2, uint16: 2,
  int: 4, int32: 4,
  uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

export interface TriangleMesh {
  /** Flat xyz triples, in millimetres once the caller has applied its scale. */
  vertices: number[];
  /** Flat index triples. */
  indices: number[];
}

export interface PlyReadResult {
  mesh: TriangleMesh;
  vertexCount: number;
  faceCount: number;
  format: string;
}

function readScalar(view: DataView, offset: number, type: PlyScalar, littleEndian: boolean): number {
  switch (type) {
    case "char": case "int8": return view.getInt8(offset);
    case "uchar": case "uint8": return view.getUint8(offset);
    case "short": case "int16": return view.getInt16(offset, littleEndian);
    case "ushort": case "uint16": return view.getUint16(offset, littleEndian);
    case "int": case "int32": return view.getInt32(offset, littleEndian);
    case "uint": case "uint32": return view.getUint32(offset, littleEndian);
    case "float": case "float32": return view.getFloat32(offset, littleEndian);
    case "double": case "float64": return view.getFloat64(offset, littleEndian);
    default: throw new Error(`Unsupported PLY scalar type "${type}"`);
  }
}

interface Property {
  name: string;
  /** Scalar type, or the count type for list properties. */
  type: PlyScalar;
  listItemType?: PlyScalar;
}

interface Element {
  name: string;
  count: number;
  properties: Property[];
}

/** Split the header out of a PLY buffer, returning parsed elements and body offset. */
function parseHeader(buffer: Buffer): { elements: Element[]; format: string; bodyOffset: number } {
  const marker = Buffer.from("end_header");
  const markerAt = buffer.indexOf(marker);
  if (markerAt < 0) throw new Error("Not a PLY file: no end_header found");
  const headerText = buffer.subarray(0, markerAt).toString("utf8");
  const newlineAt = buffer.indexOf(0x0a, markerAt);
  if (newlineAt < 0) throw new Error("PLY header is truncated: end_header has no terminating newline");

  const lines = headerText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "ply") throw new Error("Not a PLY file: missing 'ply' magic");

  let format = "";
  const elements: Element[] = [];
  for (const line of lines.slice(1)) {
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === "format") {
      format = rest[0] ?? "";
      continue;
    }
    if (keyword === "element") {
      elements.push({ name: rest[0] ?? "", count: Number.parseInt(rest[1] ?? "0", 10), properties: [] });
      continue;
    }
    if (keyword === "property") {
      const current = elements[elements.length - 1];
      if (!current) throw new Error("PLY header has a property before any element");
      if (rest[0] === "list") {
        current.properties.push({
          name: rest[3] ?? "",
          type: rest[1] as PlyScalar,
          listItemType: rest[2] as PlyScalar,
        });
      } else {
        current.properties.push({ name: rest[1] ?? "", type: rest[0] as PlyScalar });
      }
    }
  }

  return { elements, format, bodyOffset: newlineAt + 1 };
}

function triangleFan(loop: number[], push: (a: number, b: number, c: number) => void): void {
  for (let i = 1; i + 1 < loop.length; i += 1) push(loop[0], loop[i], loop[i + 1]);
}

export function parsePly(buffer: Buffer): PlyReadResult {
  const { elements, format, bodyOffset } = parseHeader(buffer);
  const vertexElement = elements.find((element) => element.name === "vertex");
  if (!vertexElement) throw new Error("PLY has no vertex element");

  const vertices: number[] = [];
  const indices: number[] = [];

  if (format === "ascii") {
    const tokens = buffer.subarray(bodyOffset).toString("utf8").split(/\s+/).filter(Boolean);
    let cursor = 0;
    for (const element of elements) {
      for (let i = 0; i < element.count; i += 1) {
        if (element === vertexElement) {
          const values = new Map<string, number>();
          for (const property of element.properties) {
            const value = Number(tokens[cursor]);
            cursor += 1;
            values.set(property.name, value);
          }
          vertices.push(values.get("x") ?? 0, values.get("y") ?? 0, values.get("z") ?? 0);
          continue;
        }
        for (const property of element.properties) {
          if (property.listItemType) {
            const listLength = Number(tokens[cursor]);
            cursor += 1;
            const loop: number[] = [];
            for (let k = 0; k < listLength; k += 1) {
              loop.push(Number(tokens[cursor]));
              cursor += 1;
            }
            if (element.name === "face" && property.name === "vertex_indices") {
              triangleFan(loop, (a, b, c) => indices.push(a, b, c));
            }
            continue;
          }
          cursor += 1;
        }
      }
    }
    return {
      mesh: { vertices, indices },
      vertexCount: vertexElement.count,
      faceCount: indices.length / 3,
      format,
    };
  }

  if (format !== "binary_little_endian" && format !== "binary_big_endian") {
    throw new Error(`Unsupported PLY format "${format}"`);
  }
  const littleEndian = format === "binary_little_endian";
  const view = new DataView(buffer.buffer, buffer.byteOffset + bodyOffset, buffer.byteLength - bodyOffset);
  let offset = 0;

  for (const element of elements) {
    // Fixed-stride elements can be walked arithmetically; list properties force a walk.
    const hasList = element.properties.some((property) => property.listItemType);
    const stride = element.properties.reduce(
      (total, property) => total + SCALAR_BYTES[property.type] + (property.listItemType ? 0 : 0),
      0,
    );
    for (let i = 0; i < element.count; i += 1) {
      if (!hasList) {
        if (element === vertexElement) {
          let cursor = offset;
          let x = 0;
          let y = 0;
          let z = 0;
          for (const property of element.properties) {
            const value = readScalar(view, cursor, property.type, littleEndian);
            cursor += SCALAR_BYTES[property.type];
            if (property.name === "x") x = value;
            else if (property.name === "y") y = value;
            else if (property.name === "z") z = value;
          }
          vertices.push(x, y, z);
        }
        offset += stride;
        continue;
      }
      for (const property of element.properties) {
        if (property.listItemType) {
          const count = readScalar(view, offset, property.type, littleEndian);
          offset += SCALAR_BYTES[property.type];
          const loop: number[] = [];
          for (let k = 0; k < count; k += 1) {
            loop.push(readScalar(view, offset, property.listItemType, littleEndian));
            offset += SCALAR_BYTES[property.listItemType];
          }
          if (element.name === "face" && property.name === "vertex_indices") {
            triangleFan(loop, (a, b, c) => indices.push(a, b, c));
          }
          continue;
        }
        offset += SCALAR_BYTES[property.type];
      }
    }
  }

  return {
    mesh: { vertices, indices },
    vertexCount: vertexElement.count,
    faceCount: indices.length / 3,
    format,
  };
}

/** Scale in place so the exported mesh carries the units the caller asked for. */
export function scaleMesh(mesh: TriangleMesh, factor: number): TriangleMesh {
  if (factor === 1) return mesh;
  return { indices: mesh.indices, vertices: mesh.vertices.map((value) => value * factor) };
}

/** Binary STL: 80-byte header, uint32 triangle count, then 50 bytes per triangle. */
export function encodeBinaryStl(mesh: TriangleMesh, header = "3dp-agent photo-to-cad"): Buffer {
  const triangles = Math.floor(mesh.indices.length / 3);
  const buffer = Buffer.alloc(84 + triangles * 50);
  buffer.write(header.slice(0, 79), 0, "utf8");
  buffer.writeUInt32LE(triangles, 80);
  let cursor = 84;
  for (let t = 0; t < triangles; t += 1) {
    const [ia, ib, ic] = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    const ax = mesh.vertices[ia * 3] ?? 0;
    const ay = mesh.vertices[ia * 3 + 1] ?? 0;
    const az = mesh.vertices[ia * 3 + 2] ?? 0;
    const bx = mesh.vertices[ib * 3] ?? 0;
    const by = mesh.vertices[ib * 3 + 1] ?? 0;
    const bz = mesh.vertices[ib * 3 + 2] ?? 0;
    const cx = mesh.vertices[ic * 3] ?? 0;
    const cy = mesh.vertices[ic * 3 + 1] ?? 0;
    const cz = mesh.vertices[ic * 3 + 2] ?? 0;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    for (const value of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      buffer.writeFloatLE(value, cursor);
      cursor += 4;
    }
    buffer.writeUInt16LE(0, cursor);
    cursor += 2;
  }
  return buffer;
}

/**
 * Convert a PLY mesh file to binary STL.
 *
 * An empty mesh is an error, not a zero-byte artefact: a downstream printer that receives
 * an empty STL learns nothing, whereas a failed conversion says exactly what went wrong.
 */
export async function plyFileToStl(
  sourcePath: string,
  outPath: string,
  options: { scale?: number } = {},
): Promise<{ triangles: number; bytes: number }> {
  const buffer = await fs.readFile(sourcePath);
  const result = parsePly(buffer);
  if (result.mesh.indices.length === 0) {
    throw new Error(`PLY mesh ${sourcePath} contains no triangle faces`);
  }
  const mesh = scaleMesh(result.mesh, options.scale ?? 1);
  const stl = encodeBinaryStl(mesh);
  await fs.writeFile(outPath, stl);
  return { triangles: result.mesh.indices.length / 3, bytes: stl.byteLength };
}
