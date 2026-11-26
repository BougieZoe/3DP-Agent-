/**
 * Provider selection for the reconstruction capability.
 *
 * `RECON_PROVIDER` picks the implementation at boot (rule 6 / rule 8). An unimplemented
 * or unknown value resolves to an explicitly unavailable provider rather than crashing
 * the server or silently falling back to something else.
 */
import { CapabilityError } from "./types.js";
import type {
  ProviderCapabilities,
  ProviderStatus,
  ProviderSubmitResult,
  ReconOutput,
  ReconstructionJob,
  ReconstructionProvider,
} from "./types.js";
import { MeshroomProvider } from "./providers/meshroom.js";

/** Placeholder for a future remote data plane. It refuses work instead of pretending. */
class UnconfiguredProvider implements ReconstructionProvider {
  readonly id: string;
  readonly version = "0";
  private readonly reason: string;

  constructor(id: string, reason: string) {
    this.id = id;
    this.reason = reason;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      id: this.id,
      version: this.version,
      available: false,
      unavailable_reason: this.reason,
      inputs: [],
      outputs: [],
      needs_gpu: false,
      license: "n/a",
    };
  }

  async submit(_job: ReconstructionJob): Promise<ProviderSubmitResult> {
    throw new CapabilityError("ENGINE_NOT_AVAILABLE", this.reason, 503);
  }

  async status(): Promise<ProviderStatus> {
    throw new CapabilityError("ENGINE_NOT_AVAILABLE", this.reason, 503);
  }

  async cancel(): Promise<void> {
    throw new CapabilityError("ENGINE_NOT_AVAILABLE", this.reason, 503);
  }

  async collect(): Promise<ReconOutput[]> {
    return [];
  }
}

export interface ProviderFactoryOptions {
  workRoot: string;
}

export function createProvider(options: ProviderFactoryOptions): ReconstructionProvider {
  const requested = (process.env.RECON_PROVIDER ?? "meshroom").trim().toLowerCase();

  if (requested === "meshroom") {
    return new MeshroomProvider({
      workRoot: options.workRoot,
      binPath: process.env.RECON_MESHROOM_BIN,
      version: process.env.RECON_MESHROOM_VERSION,
    });
  }

  if (requested === "remote") {
    return new UnconfiguredProvider(
      "remote",
      "Remote reconstruction data plane is reserved by contract but not implemented on this install. Run with RECON_PROVIDER=meshroom.",
    );
  }

  return new UnconfiguredProvider(
    requested,
    `Unknown RECON_PROVIDER "${requested}"; supported values: meshroom.`,
  );
}
