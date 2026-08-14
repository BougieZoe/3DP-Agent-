import * as THREE from 'three';

/**
 * Minimal 3MF (3D Manufacturing Format) exporter — no dependencies.
 *
 * A 3MF package is a ZIP archive (STORE method) containing:
 *   [Content_Types].xml, _rels/.rels, and 3D/3dmodel.model.
 * Modern multi-material slicers (Bambu Studio, PrusaSlicer, OrcaSlicer) consume
 * this directly, while STL is single-material only.
 */

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Build an uncompressed ZIP archive from raw file entries. */
function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Array<{ name: Uint8Array; offset: number; size: number; crc: number }> = [];
  let offset = 0;

  for (const f of files) {
    const name = encoder.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, 0x04034b50, true); // PK\x03\x04
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true); // method = STORE
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    central.push({ name, offset, size: f.data.length, crc });
    offset += 30 + name.length + f.data.length;
  }

  const centralStart = offset;
  const centralChunks: Uint8Array[] = [];
  for (const c of central) {
    const cd = new DataView(new ArrayBuffer(46 + c.name.length));
    cd.setUint32(0, 0x02014b50, true); // PK\x01\x02
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, c.crc, true);
    cd.setUint32(20, c.size, true);
    cd.setUint32(24, c.size, true);
    cd.setUint16(28, c.name.length, true);
    cd.setUint32(42, c.offset, true);
    centralChunks.push(new Uint8Array(cd.buffer), c.name);
  }
  const centralSize = centralChunks.reduce((a, b) => a + b.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // PK\x05\x06
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);

  return concat([...chunks, ...centralChunks, new Uint8Array(eocd.buffer)]);
}

function fmt(v: number): string {
  return v.toFixed(3);
}

/** Convert a BufferGeometry into a valid 3MF package (ZIP bytes). */
export function geometryToThreeMf(geometry: THREE.BufferGeometry): ArrayBuffer {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const vertexCount = pos.count;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  lines.push('  <resources><object id="1" type="model"><mesh><vertices>');
  const pa = pos.array as Float32Array;
  for (let i = 0; i < vertexCount; i++) {
    lines.push(
      `    <vertex x="${fmt(pa[i * 3])}" y="${fmt(pa[i * 3 + 1])}" z="${fmt(pa[i * 3 + 2])}"/>`,
    );
  }
  lines.push('  </vertices><triangles>');
  const triCount = index ? index.count / 3 : vertexCount / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    lines.push(`    <triangle v1="${i0}" v2="${i1}" v3="${i2}"/>`);
  }
  lines.push('  </triangles></mesh></object></resources>');
  lines.push('  <build><item objectid="1"/></build>');
  lines.push('</model>');

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>';

  const encoder = new TextEncoder();
  const zip = zipStore([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rels) },
    { name: '3D/3dmodel.model', data: encoder.encode(lines.join('\n')) },
  ]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}
