import * as THREE from 'three';
import { createMeshFromGeometry } from './meshHelpers';
import { parseSTL } from './stlParser';

export { createMeshFromGeometry };

export async function loadSTLFile(file: File): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const geometry = parseSTL(arrayBuffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        resolve(geometry);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsArrayBuffer(file);
  });
}
