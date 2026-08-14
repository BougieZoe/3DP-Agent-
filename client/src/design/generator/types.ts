/**
 * generator — single contract for every "produce STL bytes from a prompt"
 * engine in the product (build123d text-to-CAD, Tripo text-to-3D, mock).
 *
 * This replaces the previous two parallel abstractions:
 *   - CADGenerationTransport (sync generate → outcome)
 *   - MeshGenerationProvider (async submit → poll)
 * with ONE job lifecycle: submit → poll → settle. Synchronous engines are a
 * special case that settle on the first poll. The consumer facade
 * (service.ts) owns the poll budget / backoff / abort and the inbound STL
 * contract, so adapters stay thin.
 */
import type { GeneratedModel } from '@shared/domain/generatedModel';

export interface GeneratorRequest {
  prompt: string;
  locale?: string;
  constraints?: {
    targetPrinter?: string;
    materialName?: string;
    maxDimensionMm?: number;
  };
  /** Incremental edit of a previous generation (CAD engines only). */
  baseModel?: { generatedModelId: string; editInstruction: string };
  /** Data-driven parameter overrides (server-side bound; CAD engines only). */
  params?: Record<string, number>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GenerationResult {
  /** CAD: the GeneratedModel.id; mesh: the provider job id. */
  modelId: string;
  /** Binary STL, millimeters. */
  stlBytes: ArrayBuffer;
  /** CAD engines: the full generation document. */
  generatedModel?: GeneratedModel;
  repaired?: boolean;
  repairType?: string;
  attempts?: number;
}

export type GenerationError =
  | { code: 'transport-unavailable'; detail: string }
  | { code: 'generation-failed'; detail: string }
  | { code: 'generation-timeout'; timeoutMs: number }
  | { code: 'invalid-artifact'; detail: string }
  | { code: 'cancelled' };

export type GenerationOutcome =
  | { ok: true; result: GenerationResult }
  | { ok: false; error: GenerationError };

export interface GeneratorJob {
  id: string;
  provider: string;
}

export type GeneratorJobState =
  | { status: 'queued' | 'running' }
  | { status: 'succeeded'; payload: GeneratorPayload }
  | { status: 'failed'; code: GenerationError['code']; reason: string };

export type GeneratorPayload =
  | {
      kind: 'cad';
      result: {
        generatedModel: GeneratedModel;
        stlBytes: ArrayBuffer;
        repaired?: boolean;
        repairType?: string;
        attempts?: number;
      };
    }
  | { kind: 'mesh'; stlBytes: ArrayBuffer };

export interface GeneratorAdapter {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  /** Start the job. For synchronous engines this kicks off the request and
   * returns a handle immediately; the first poll settles it. */
  submit(request: GeneratorRequest): Promise<GeneratorJob>;
  poll(handle: GeneratorJob, signal?: AbortSignal): Promise<GeneratorJobState>;
}

export const DEFAULT_GENERATE_TIMEOUT_MS = 180_000;