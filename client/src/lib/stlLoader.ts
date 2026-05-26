import * as THREE from 'three';
import { createMeshFromGeometry } from './meshHelpers';

export { createMeshFromGeometry };

export async function loadSTLFile(file: File): Promise<THREE.BufferGeometry> {
  const arrayBuffer = await file.arrayBuffer();

  const worker = new Worker(
    new URL('./stlWorker.ts', import.meta.url),
    { type: 'module' },
  );

  return new Promise<THREE.BufferGeometry>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.error) {
        reject(new Error(e.data.error));
        worker.terminate();
        return;
      }

      const { position, normal, index } = e.data;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      worker.terminate();
      resolve(geometry);
    };

    worker.onerror = (err) => {
      reject(new Error(`Worker error: ${err.message}`));
      worker.terminate();
    };

    worker.postMessage(arrayBuffer, [arrayBuffer]);
  });
}
