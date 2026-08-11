import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import type { MeshGenerationProvider, MeshJobHandle, MeshJobState, MeshGenerationRequest } from './types';

export interface MockMeshProviderOptions {
  /** Simulated generation latency (ms). */
  delayMs?: number;
  /** Procedural shape to emit. */
  shape?: 'torus' | 'box' | 'sphere';
  fetchImpl?: never; // placeholder to keep the options shape consistent
}

/**
 * Local procedural mesh provider. Produces a real, valid STL (via three.js)
 * so the "mesh → parse → analysis" pipeline can be exercised end-to-end with
 * no API key. Also the demo/fallback when no hosted provider is configured.
 */
export function createMockMeshProvider(options: MockMeshProviderOptions = {}): MeshGenerationProvider {
  const delayMs = options.delayMs ?? 600;
  const shape = options.shape ?? 'torus';

  function geometryFor(shape: MockMeshProviderOptions['shape']): THREE.BufferGeometry {
    switch (shape) {
      case 'box':
        return new THREE.BoxGeometry(40, 30, 20);
      case 'sphere':
        return new THREE.SphereGeometry(12, 32, 24);
      case 'torus':
      default:
        return new THREE.TorusGeometry(12, 4, 16, 32);
    }
  }

  return {
    id: 'mock',

    async isAvailable(): Promise<boolean> {
      return true;
    },

    async generate(_request: MeshGenerationRequest): Promise<MeshJobHandle> {
      return { id: `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, provider: 'mock' };
    },

    async poll(_handle: MeshJobHandle): Promise<MeshJobState> {
      await new Promise((r) => setTimeout(r, delayMs));
      const geometry = geometryFor(shape);
      const mesh = new THREE.Mesh(geometry);
      const out = new STLExporter().parse(mesh, { binary: true });
      geometry.dispose();
      const stlBytes: ArrayBuffer =
        out instanceof DataView
          ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
          : new TextEncoder().encode(String(out)).buffer;
      return { status: 'succeeded', stlBytes };
    },
  };
}
