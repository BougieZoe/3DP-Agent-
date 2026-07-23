import type { PrinterProfileId } from '@/analysis/types';
import type { Material } from '@/lib/materialState';
import type { GeneratedModel } from '@shared/domain/generatedModel';
import type { CADGenerationTransport } from './transport/types';

/**
 * CADGenerationService — turns a natural-language design intent into STL
 * bytes + metadata. The service itself does NOT parse geometry, run
 * analysis, or author build123d source — generation happens behind a
 * CADGenerationTransport (local bridge / remote proxy).
 *
 * Usage:
 *   const transport = createLocalBridgeTransport({ llm: { ... } });
 *   const service = createCadGenerationService(transport);
 *   const outcome = await service.generate({ prompt: 'a 20mm cube' });
 */

export interface CADGenerationRequest {
  prompt: string;
  locale?: string;
  constraints?: {
    targetPrinter?: PrinterProfileId;
    material?: Material;
    maxDimensionMm?: number;
  };
  /**
   * Incremental edit of a previous generation. `generatedModelId` refers to
   * a prior GeneratedModel.id; `editInstruction` describes the change
   * ("make the wall 3mm thick"). The resulting GeneratedModel carries
   * `parentModelId` pointing back at it. Absent = fresh design.
   */
  baseModel?: {
    generatedModelId: string;
    editInstruction: string;
  };
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CADGenerationResult {
  model: GeneratedModel;
  /** Binary STL, millimeters — ready for the existing parseSTL path. */
  stlBytes: ArrayBuffer;
}

export type CADGenerationError =
  | { code: 'transport-unavailable'; detail: string }
  | { code: 'generation-failed'; detail: string }
  | { code: 'generation-timeout'; timeoutMs: number }
  /** Contract breach: missing STL artifact, non-mm units, or empty geometry. */
  | { code: 'invalid-artifact'; detail: string }
  | { code: 'cancelled' };

export type CADGenerationOutcome =
  | { ok: true; result: CADGenerationResult }
  | { ok: false; error: CADGenerationError };

export interface CADGenerationService {
  generate(request: CADGenerationRequest): Promise<CADGenerationOutcome>;
}

/**
 * createCadGenerationService — factory that binds a generation transport
 * (local bridge / remote proxy) to the CADGenerationService interface.
 *
 * The caller owns transport selection and lifecycle; the service owns
 * request validation, retry/fallback logic, and telemetry hooks (future).
 */
export function createCadGenerationService(
  transport: CADGenerationTransport,
): CADGenerationService {
  return {
    async generate(request: CADGenerationRequest): Promise<CADGenerationOutcome> {
      // Forward the request to the configured transport.
      // Future: add pre-flight validation, retry with backoff, telemetry.
      return await transport.generate(request);
    },
  };
}
