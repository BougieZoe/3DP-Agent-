import * as THREE from 'three';
import { type GeometryModel, createGeometryModel } from './geometryModel';

export function fromThreeBufferGeometry(geo: THREE.BufferGeometry): GeometryModel {
  const pos = geo.getAttribute('position');
  if (!pos) {
    return createGeometryModel(
      new Float32Array(0),
      new Float32Array(0),
      new Uint32Array(0),
    );
  }

  const normAttr = geo.getAttribute('normal');
  const positions = pos.array as Float32Array;
  const normals = normAttr
    ? normAttr.array as Float32Array
    : new Float32Array(positions.length);

  const index = geo.getIndex();
  const indices = index
    ? new Uint32Array(index.array)
    : new Uint32Array(0);

  return createGeometryModel(positions, normals, indices);
}

export function toThreeBufferGeometry(model: GeometryModel): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
  if (model.indices.length > 0) {
    geo.setIndex(new THREE.BufferAttribute(model.indices, 1));
  }
  return geo;
}
