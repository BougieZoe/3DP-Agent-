import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type {
  GeneratorAdapter,
  GeneratorJob,
  GeneratorJobState,
  GeneratorRequest,
} from './types';

/**
 * Local procedural mesh adapter. Produces a real, valid STL (via three.js) so
 * the "mesh → parse → analysis" pipeline can be exercised end-to-end with no
 * API key or server. When shape is 'auto' (default) it picks a primitive from
 * prompt keywords so the demo feels alive. Fallback when no hosted provider is
 * reachable/configured.
 */

export type MockShape = 'torus' | 'box' | 'sphere' | 'cylinder';

export interface MockAdapterOptions {
  /** Simulated generation latency (ms). */
  delayMs?: number;
  /** Fixed shape to emit, or 'auto' (default) to pick from the prompt. */
  shape?: MockShape | 'auto';
}

const SHAPE_KEYWORDS: Array<[MockShape, RegExp]> = [
  ['torus', /gear|wheel|washer|donut|ring|tire|torus|toroid/],
  ['box', /box|cube|block|brick|crate|plate/],
  ['cylinder', /cylinder|tube|pipe|can|column|pillar|pen/],
  ['sphere', /sphere|ball|globe|orb|marble|head/],
];

const ALL_SHAPES: MockShape[] = ['torus', 'box', 'sphere', 'cylinder'];

/** Match a prompt keyword to a shape, or null when nothing matches. */
export function matchShape(prompt: string): MockShape | null {
  const p = prompt.toLowerCase();
  for (const [shape, re] of SHAPE_KEYWORDS) {
    if (re.test(p)) return shape;
  }
  return null;
}

/** Deterministic keyword pick, defaulting to torus. */
export function shapeForPrompt(prompt: string): MockShape {
  return matchShape(prompt) ?? 'torus';
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

export function createMockMeshAdapter(options: MockAdapterOptions = {}): GeneratorAdapter {
  const delayMs = options.delayMs ?? 600;
  const fixed = options.shape ?? 'auto';
  const shapeByHandle = new Map<string, MockShape>();

  return {
    id: 'mock',

    async isAvailable(): Promise<boolean> {
      return true;
    },

    async submit(request: GeneratorRequest): Promise<GeneratorJob> {
      const id = `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      // Keyword match → that shape; otherwise a random primitive so a custom
      // prompt always produces a visibly-new result instead of a silent default.
      const matched = matchShape(request.prompt);
      const shape =
        fixed === 'auto'
          ? matched ?? ALL_SHAPES[Math.floor(Math.random() * ALL_SHAPES.length)]
          : fixed;
      shapeByHandle.set(id, shape);
      return { id, provider: 'mock' };
    },

    async poll(handle: GeneratorJob): Promise<GeneratorJobState> {
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
      return { status: 'succeeded', payload: { kind: 'mesh', stlBytes } };
    },
  };
}