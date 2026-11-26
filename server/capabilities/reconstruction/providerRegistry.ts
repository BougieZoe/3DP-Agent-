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
import { ColmapProvider } from "./providers/colmap.js";
import { ApplePhotogrammetryProvider } from "./providers/applePhotogrammetry.js";

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
  // Platform default, not a silent fallback: Meshroom was the original choice but no
  // longer ships a macOS build, so on macOS the default is the engine that can actually
  // produce a mesh. On other hosts Meshroom stays the default. Either way the chosen
  // engine reports its own availability truthfully through /v1/capabilities.
  const platformDefault = process.platform === "darwin" ? "apple" : "meshroom";
  const requested = (process.env.RECON_PROVIDER ?? platformDefault).trim().toLowerCase();

  if (requested === "meshroom") {
    return new MeshroomProvider({
      workRoot: options.workRoot,
      binPath: process.env.RECON_MESHROOM_BIN,
      version: process.env.RECON_MESHROOM_VERSION,
    });
  }

  if (requested === "apple") {
    return new ApplePhotogrammetryProvider({
      workRoot: options.workRoot,
      detail: process.env.RECON_APPLE_DETAIL,
      version: process.env.RECON_APPLE_VERSION,
    });
  }

  if (requested === "remote") {
    return new UnconfiguredProvider(
      "remote",
      "Remote reconstruction data plane is reserved by contract but not implemented on this install. Run with RECON_PROVIDER=apple, colmap or meshroom.",
    );
  }

  if (requested === "colmap") {
    // Kept for hosts with CUDA: on Apple silicon COLMAP can register cameras but its
    // dense stereo stage refuses to run, so it reports itself unavailable there instead of
    // stopping halfway through a job.
    return new ColmapProvider({
      workRoot: options.workRoot,
      binPath: process.env.RECON_COLMAP_BIN,
      version: process.env.RECON_COLMAP_VERSION,
    });
  }

  return new UnconfiguredProvider(
    requested,
    `Unknown RECON_PROVIDER "${requested}"; supported values: apple, colmap, meshroom.`,
  );
}
