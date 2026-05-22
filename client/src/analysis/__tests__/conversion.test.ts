import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fromThreeBufferGeometry, toThreeBufferGeometry } from '../geometryConversion';
import { buildGeometryGraph } from '../geometryGraph';
import { createWatertightCube, createIcosphere } from './testMeshes';

describe('Three.js conversion consistency', () => {
  it('round-trip preserves positions and indices', () => {
    const src = createWatertightCube();
    const posAttr = src.getAttribute('position')!;
    const idxAttr = src.getIndex()!;
    const origPos = new Float32Array(posAttr.array as Float32Array);
    const origIdx = new Uint32Array(idxAttr.array);

    const model = fromThreeBufferGeometry(src);
    expect(model.positions.length).toBe(origPos.length);
    expect(model.indices.length).toBe(origIdx.length);

    for (let i = 0; i < origPos.length; i++) {
      expect(model.positions[i]).toBe(origPos[i]);
    }
    for (let i = 0; i < origIdx.length; i++) {
      expect(model.indices[i]).toBe(origIdx[i]);
    }

    const back = toThreeBufferGeometry(model);
    const backPos = back.getAttribute('position')!.array as Float32Array;
    const backIdx = back.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < origPos.length; i++) {
      expect(backPos[i]).toBe(origPos[i]);
    }
    for (let i = 0; i < origIdx.length; i++) {
      expect(backIdx[i]).toBe(origIdx[i]);
    }
  });

  it('fromThreeBufferGeometry handles non-indexed geometry', () => {
    const src = new THREE.BufferGeometry();
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    src.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const model = fromThreeBufferGeometry(src);
    expect(model.indices.length).toBe(0);
    expect(model.triangleCount).toBe(1);
  });

  it('fromThreeBufferGeometry handles geometry with normals', () => {
    const src = createIcosphere(1);

    const model = fromThreeBufferGeometry(src);
    expect(model.positions.length).toBeGreaterThan(0);
    expect(model.indices.length).toBeGreaterThan(0);
    expect(model.normals.length).toBe(model.positions.length);
  });

  it('buildGeometryGraph produces same results from model', () => {
    const model = fromThreeBufferGeometry(createWatertightCube());

    const graphFromModel = buildGeometryGraph(model);
    expect(graphFromModel).not.toBeNull();
    expect(graphFromModel!.triangleCount).toBe(12);
    expect(graphFromModel!.edgeMap.size).toBe(18);
    expect(graphFromModel!.boundingBoxDimensions.x).toBeCloseTo(1, 5);
    expect(graphFromModel!.boundingBoxDimensions.y).toBeCloseTo(1, 5);
    expect(graphFromModel!.boundingBoxDimensions.z).toBeCloseTo(1, 5);
  });

  it('conversion does not modify original geometry', () => {
    const src = createWatertightCube();
    const origPos = new Float32Array(src.getAttribute('position')!.array as Float32Array);
    const origIdx = new Uint32Array(src.getIndex()!.array);

    fromThreeBufferGeometry(src);

    const posAfter = src.getAttribute('position')!.array as Float32Array;
    const idxAfter = src.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < origPos.length; i++) {
      expect(posAfter[i]).toBe(origPos[i]);
    }
    for (let i = 0; i < origIdx.length; i++) {
      expect(idxAfter[i]).toBe(origIdx[i]);
    }
  });
});
