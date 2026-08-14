import type { CADGenerationOutcome, CADGenerationRequest } from '../cadGenerationService';

/**
 * CADGenerationTransport — environment-specific execution of a generation
 * request. Implementations:
 * - `localBridge` (dev): POST to the local Express route that shells out to
 *   the machine's Python + CAD skill installation.
 * - `remoteProxy` (prod, planned): POST to a serverless function forwarding
 *   to a hosted CAD worker.
 */
export interface CADGenerationTransport {
  readonly id: 'local-bridge' | 'remote-proxy';
  isAvailable(): Promise<boolean>;
  generate(request: CADGenerationRequest): Promise<CADGenerationOutcome>;
}
