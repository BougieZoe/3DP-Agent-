import * as THREE from 'three';

export interface IndexedTriangle {
  a: number;
  b: number;
  c: number;
}

const VERTEX_EQUALITY_EPSILON = 1e-8;

/**
 * Fast vertex dedup with nested numeric Maps.
 *
 * The previous implementation built a Map<string, number> with a formatted
 * string key per vertex plus two JS number[] raw buffers — for a 1.5M-triangle
 * STL that peaked at ~700 MB inside the parse worker (string allocation +
 * boxed doubles) and was a major contributor to mobile OOM crashes.
 *
 * The nested Map uses the SAME 1e-8 grid rounding but only integer numeric
 * keys, so dedup results are byte-identical to the old string-keyed map while
 * allocating a fraction of the memory: no string formatting, no double arrays.
 *
 * The first occurrence of a vertex wins (its face's normal is kept), matching
 * the original implementation exactly.
 */
class VertexDedup {
  private map = new Map<number, Map<number, Map<number, number>>>();
  private count = 0;

  constructor(
    private outPos: Float32Array,
    private outNorm: Float32Array,
  ) {}

  /** Round a coordinate onto the 1e-8 grid (same quantization as before). */
  static key(x: number): number {
    return Math.round(x / VERTEX_EQUALITY_EPSILON);
  }

  /**
   * Return the vertex index for (ix, iy, iz), appending the vertex with its
   * face normal when it is seen for the first time.
   */
  findOrAdd(ix: number, iy: number, iz: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    let m2 = this.map.get(ix);
    if (!m2) { m2 = new Map(); this.map.set(ix, m2); }
    let m3 = m2.get(iy);
    if (!m3) { m3 = new Map(); m2.set(iy, m3); }
    const existing = m3.get(iz);
    if (existing !== undefined) return existing;

    const idx = this.count++;
    m3.set(iz, idx);
    const p = idx * 3;
    this.outPos[p] = x;
    this.outPos[p + 1] = y;
    this.outPos[p + 2] = z;
    this.outNorm[p] = nx;
    this.outNorm[p + 1] = ny;
    this.outNorm[p + 2] = nz;
    return idx;
  }

  get vertexCount(): number {
    return this.count;
  }
}

/**
 * Trim a preallocated buffer down to `count` elements. Always returns a fresh
 * copy: a subarray view would share the (much larger) parent ArrayBuffer,
 * which a zero-copy postMessage transfer would then have to ship in full.
 */
function trim<T extends Float32Array>(buf: T, count: number): T {
  if (buf.length === count) return buf;
  return buf.subarray(0, count).slice() as T;
}

function parseBinarySTLIndexed(view: DataView): THREE.BufferGeometry {
  const faces = view.getUint32(80, true);
  const geometry = new THREE.BufferGeometry();
  // Preallocate worst-case (all vertices unique); trimmed before returning.
  const outPos = new Float32Array(faces * 9);
  const outNorm = new Float32Array(faces * 9);
  const indices = new Uint32Array(faces * 3);
  const dedup = new VertexDedup(outPos, outNorm);

  let offset = 84;
  let vi = 0;

  for (let i = 0; i < faces; i++) {
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;

    for (let j = 0; j < 3; j++) {
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const z = view.getFloat32(offset, true); offset += 4;
      indices[vi++] = dedup.findOrAdd(
        VertexDedup.key(x), VertexDedup.key(y), VertexDedup.key(z),
        x, y, z, nx, ny, nz,
      );
    }

    offset += 2;
  }

  const positions = trim(outPos, dedup.vertexCount * 3);
  const normals = trim(outNorm, dedup.vertexCount * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

/** Count `facet normal` occurrences so the ASCII path can preallocate too. */
function countAsciiFacets(stlString: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = stlString.indexOf('facet normal', idx)) !== -1) {
    count++;
    idx += 'facet normal'.length;
  }
  return count;
}

function parseASCIISTLIndexed(stlString: string): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const facetCount = countAsciiFacets(stlString);
  const outPos = new Float32Array(facetCount * 9);
  const outNorm = new Float32Array(facetCount * 9);
  const indices = new Uint32Array(facetCount * 3);
  const dedup = new VertexDedup(outPos, outNorm);

  const facetPattern = /facet\s+normal\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+outer\s+loop([\s\S]*?)endloop/g;
  const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;

  let facetMatch;
  let vi = 0;
  while ((facetMatch = facetPattern.exec(stlString)) !== null) {
    const normalX = parseFloat(facetMatch[1]);
    const normalY = parseFloat(facetMatch[3]);
    const normalZ = parseFloat(facetMatch[5]);
    const vertexBlock = facetMatch[7];

    vertexPattern.lastIndex = 0;
    let vertexCount = 0;
    let vertexMatch;

    while ((vertexMatch = vertexPattern.exec(vertexBlock)) !== null && vertexCount < 3) {
      const x = parseFloat(vertexMatch[1]);
      const y = parseFloat(vertexMatch[3]);
      const z = parseFloat(vertexMatch[5]);
      indices[vi++] = dedup.findOrAdd(
        VertexDedup.key(x), VertexDedup.key(y), VertexDedup.key(z),
        x, y, z, normalX, normalY, normalZ,
      );
      vertexCount++;
    }
  }

  const positions = trim(outPos, dedup.vertexCount * 3);
  const normals = trim(outNorm, dedup.vertexCount * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

export function isASCIISTL(arrayBuffer: ArrayBuffer): boolean {
  const view = new Uint8Array(arrayBuffer);
  const header = new TextDecoder().decode(view.slice(0, 5));
  return header === 'solid';
}

export function parseSTL(arrayBuffer: ArrayBuffer): THREE.BufferGeometry {
  const isASCII = isASCIISTL(arrayBuffer);

  if (isASCII) {
    return parseASCIISTLIndexed(new TextDecoder().decode(arrayBuffer));
  }
  return parseBinarySTLIndexed(new DataView(arrayBuffer));
}
