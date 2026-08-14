import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { geometryToThreeMf } from '../threeMf';

function toText(buf: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buf));
}

describe('geometryToThreeMf', () => {
  it('produces a valid ZIP archive (PK signature) with the 3MF parts', () => {
    const bytes = new Uint8Array(geometryToThreeMf(new THREE.BoxGeometry(10, 10, 10)));
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03); // local file header signature
    expect(bytes[3]).toBe(0x04);

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('3D/3dmodel.model');
  });

  it('emits the model XML with vertices and triangles', () => {
    const text = toText(geometryToThreeMf(new THREE.BoxGeometry(10, 10, 10)));
    expect(text).toContain('<model unit="millimeter"');
    expect(text).toContain('<object id="1"');
    expect(text).toContain('<vertex x="5.000" y="-5.000" z="5.000"/>');
    expect(text).toContain('<triangle v1="');
    expect(text).toContain('<build><item objectid="1"/>');
  });

  it('handles non-indexed geometry', () => {
    const geo = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const text = toText(geometryToThreeMf(geo));
    expect(text).toContain('<triangle v1="');
    expect(text).toContain('<vertex x="');
  });
});
