import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import type { MeshGenerationProvider, MeshJobHandle, MeshJobState, MeshGenerationRequest } from './types';

export type MockShape = 'torus' | 'box' | 'sphere' | 'cylinder';

export interface MockMeshProviderOptions {
  /** Simulated generation latency (ms). */
  delayMs?: number;
  /** Fixed shape to emit, or 'auto' (default) to pick from the prompt. */
  shape?: MockShape | 'auto';
}

/** Pick a procedural shape from natural-language keywords. */
export function shapeForPrompt(prompt: string): MockShape {
  const p = prompt.toLowerCase();
  if (/gear|wheel|washer|donut|ring|tire|torus|toroid/.test(p)) return 'torus';
  if (/box|cube|block|brick|crate|plate/.test(p)) return 'box';
  if (/cylinder|tube|pipe|can|column|pillar|pen/.test(p)) return 'cylinder';
  if (/sphere|ball|globe|orb|marble|head/.test(p)) return 'sphere';
  return 'torus';
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Slightly randomized primitive so repeated generation (REGENERATE) yields variants. */
function geometryFor(shape: MockShape): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(rand(30, 50), rand(24, 40), rand(15, 25));
    case 'sphere':
      return new THREE.SphereGeometry(rand(9, 14), 32, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(rand(7, 10), rand(7, 10), rand(24, 36), 32);
    case 'torus':
    default:
      return new THREE.TorusGeometry(rand(10, 14), rand(3, 5), 16, 32);
  }
}

/**
 * Local procedural mesh provider. Produces a real, valid STL (via three.js)
 * so the "mesh → parse → analysis" pipeline can be exercised end-to-end with
 * no API key. When shape is 'auto' (default) it picks a primitive from prompt
 * keywords so the demo feels alive. Also the fallback when no hosted provider
 * is configured.
 */
export function createMockMeshProvider(options: MockMeshProviderOptions = {}): MeshGenerationProvider {
  const delayMs = options.delayMs ?? 600;
  const fixed = options.shape ?? 'auto';
  const shapeByHandle = new Map<string, MockShape>();

  return {
    id: 'mock',

    async isAvailable(): Promise<boolean> {
      return true;
    },

    async generate(request: MeshGenerationRequest): Promise<MeshJobHandle> {
      const id = `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      shapeByHandle.set(id, fixed === 'auto' ? shapeForPrompt(request.prompt) : fixed);
      return { id, provider: 'mock' };
    },

    async poll(handle: MeshJobHandle): Promise<MeshJobState> {
      await new Promise((r) => setTimeout(r, delayMs));
      const shape = shapeByHandle.get(handle.id) ?? 'torus';
      shapeByHandle.delete(handle.id);
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
