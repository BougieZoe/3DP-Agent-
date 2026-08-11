import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { countTriangles, decimateGeometry } from '../meshOps';

describe('meshOps', () => {
  it('counts triangles on indexed geometry', () => {
    const g = new THREE.TorusGeometry(10, 3, 8, 16);
    expect(countTriangles(g)).toBe(8 * 16 * 2);
  });

  it('decimates toward a target and keeps normals valid', () => {
    const g = new THREE.TorusGeometry(10, 3, 8, 16);
    const before = countTriangles(g);
    const out = decimateGeometry(g, Math.floor(before / 2));
    expect(countTriangles(out)).toBeLessThan(before);
    expect(out.attributes.normal).toBeDefined();
  });

  it('returns the input unchanged when already under the target', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const out = decimateGeometry(g, 100_000);
    expect(out).toBe(g);
  });

  it('handles non-indexed geometry by re-indexing first', () => {
    const g = new THREE.TorusGeometry(10, 3, 8, 16).toNonIndexed();
    const out = decimateGeometry(g, 100);
    expect(countTriangles(out)).toBeLessThan(countTriangles(g));
  });

  it('never returns an empty mesh, even under aggressive decimation', () => {
    const g = new THREE.TorusGeometry(10, 3, 16, 32); // 2048 tris
    const out = decimateGeometry(g, 50);
    expect(countTriangles(out)).toBeGreaterThan(0);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
