import * as THREE from 'three';

export function createMeshFromGeometry(geometry: THREE.BufferGeometry): THREE.Mesh {
  const material = new THREE.MeshPhongMaterial({
    color: 0xf4a9b4,
    emissive: 0xf4a9b4,
    emissiveIntensity: 0.15,
    shininess: 100,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
