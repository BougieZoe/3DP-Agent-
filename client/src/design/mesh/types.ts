/**
 * MeshGenerationProvider — async generation of triangle meshes from text (and
 * later, images). Mirrors the CADGenerationTransport pattern, but the hosted
 * Mesh APIs (Tripo / Meshy) are asynchronous: submit a job, then poll until
 * it succeeds. The result is STL/GLB bytes that feed the shared analysis
 * pipeline unchanged.
 */

export interface MeshGenerationRequest {
  prompt: string;
  /** Reference image for image-to-3D (planned). */
  refImage?: Blob;
  /** Preferred output container. STL is what the analysis pipeline consumes. */
  format?: 'glb' | 'stl';
  signal?: AbortSignal;
}

export interface MeshJobHandle {
  id: string;
  provider: string;
}

export type MeshJobState =
  | { status: 'queued' }
  | { status: 'running' }
  | {
      status: 'succeeded';
      stlBytes: ArrayBuffer;
      glbBytes?: ArrayBuffer;
    }
  | { status: 'failed'; reason: string };

export interface MeshGenerationProvider {
  readonly id: string;
  /** Submit a generation job (does not block for the result). */
  generate(request: MeshGenerationRequest): Promise<MeshJobHandle>;
  /** Poll a submitted job until it resolves to a final state. */
  poll(handle: MeshJobHandle): Promise<MeshJobState>;
  isAvailable(): Promise<boolean>;
}
