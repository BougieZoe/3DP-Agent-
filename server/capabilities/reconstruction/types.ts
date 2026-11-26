/**
 * Photo-to-CAD capability — domain types.
 *
 * Contract: docs/capability-open-standard-contract.md (v0.1)
 * Discipline: AGENTS.md -> "Hard rules — Open-Standard Capability Discipline".
 *
 * Nothing in this file knows which engine runs the job. That is the whole point:
 * the engine lives behind ReconstructionProvider, and this vocabulary is the thing
 * external consumers depend on.
 */

export const RECON_OUTPUT_FORMATS = ["step", "stl", "glb", "3mf", "obj"] as const;
export type ReconOutputFormat = (typeof RECON_OUTPUT_FORMATS)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Terminal states never transition again; pollers rely on this. */
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/**
 * Tenant context. Rule 4: always present, defaults to "local", never null.
 * Isolation is NOT implemented yet and this type must not imply that it is.
 */
export interface TenantContext {
  tenant_id: string;
  workspace_id: string;
}

export const DEFAULT_TENANT_ID = "local";
export const DEFAULT_WORKSPACE_ID = "local";

export interface ReconImageInput {
  /** Reference to an asset already known to the platform. */
  asset_id?: string;
  /** Local filesystem path (local provider only; never exposed to remote tenants). */
  path?: string;
  /** Free-form hint: overview | detail | scale. */
  role?: string;
}

/**
 * How the caller pins the reconstruction to a real-world size.
 *
 * Photogrammetry engines reconstruct up to similarity: the shape is right, the scale is
 * arbitrary. A scale reference is therefore applied as a post-reconstruction geometry
 * correction, not as an engine hint — which is why `known_mm` alone is not enough and the
 * caller must say *what* that known millimetre figure measures.
 *
 * v1 kinds:
 * - `known_dimension` — `known_mm` is the measured extent along `axis` of the mesh.
 * - `two_point` — `known_mm` is the distance between `points[0]` and `points[1]`.
 *
 * Marker detection (`calibration_board`) is not implemented: engines do not emit it and
 * guessing a board pose would silently produce a wrongly-scaled part.
 */
export interface ScaleReference {
  kind: string;
  known_mm: number;
  /** Required for kind=known_dimension: which axis of the mesh the known_mm spans. */
  axis?: "x" | "y" | "z";
  /** Required for kind=two_point: two vertices of the reconstructed mesh. */
  points?: Array<{ x: number; y: number; z: number }>;
}

/**
 * What was actually done to the geometry, recorded on the job so a consumer can tell a
 * calibrated model from an arbitrary-scale one without re-measuring the file.
 */
export interface AppliedScale {
  /** `axis:x` | `axis:y` | `axis:z` | `two_point` */
  source: string;
  /** Always millimetres, as the request field name promises. */
  known_mm: number;
  /** Extent of the mesh along that source before scaling, in the engine's own units. */
  measured_mm: number;
  /**
   * Unit the delivered mesh is numbered in. Equal to the job's `output.units`, so a caller can
   * verify calibration arithmetically: mesh extent along `source` == known_mm / MM_PER_UNIT[units].
   */
  units: "mm" | "cm" | "in";
  /** Multiplier actually applied to every vertex: (known_mm / measured_mm) / MM_PER_UNIT[units]. */
  factor: number;
  applied_at: string;
}

export interface ReconOutputSpec {
  formats: ReconOutputFormat[];
  units: "mm" | "cm" | "in";
}

/** Wire shape accepted by POST /v1/reconstructions. */
export interface ReconSubmitRequest {
  tenant_id?: string;
  workspace_id?: string;
  input: {
    images: ReconImageInput[];
    scale_reference?: ScaleReference;
  };
  output?: Partial<ReconOutputSpec>;
  /** Advisory only — the server may ignore it (rule 6: engine choice is ours). */
  engine_hint?: string;
  webhook_url?: string;
}

export interface ReconOutput {
  format: ReconOutputFormat;
  asset_id?: string;
  /** Absolute path for the local provider. Remote providers will return asset ids only. */
  path?: string;
  bytes: number;
}

/** One row per executed job. This is the billing unit (rule 5), not a log line. */
export interface UsageRecord {
  job_id: string;
  tenant_id: string;
  workspace_id: string;
  provider: string;
  provider_version: string;
  images: number;
  wall_seconds: number;
  gpu_seconds: number | null;
  output_bytes: number;
  finished_at: string;
}

export interface JobError {
  /** Machine-readable: ENGINE_NOT_AVAILABLE | INPUT_NOT_FOUND | ENGINE_FAILED | ... */
  code: string;
  message: string;
}

export interface JobProgress {
  stage: string;
  percent: number;
}

export interface JobEngine {
  provider: string;
  version: string;
}

export interface ReconstructionJob {
  job_id: string;
  tenant_id: string;
  workspace_id: string;
  status: JobStatus;
  progress: JobProgress;
  engine: JobEngine;
  outputs: ReconOutput[];
  usage: Partial<UsageRecord> | null;
  /**
   * Present once a scale reference has been applied to the delivered geometry. Absent means
   * the mesh is at the engine's arbitrary scale — never assume millimetres without this.
   */
  scale?: AppliedScale;
  created_at: string;
  updated_at: string;
  error?: JobError;
  /** Provider-side identifier; never part of the public contract surface. */
  provider_job_id?: string;
  idempotency_key?: string;
  /**
   * @internal Original inputs, kept so a local provider can re-read its source files.
   * Stripped by toPublicJob() before anything leaves the process — it is not contract.
   */
  input_snapshot?: ReconSubmitRequest["input"];
  /**
   * @internal Webhook target. Stripped before serialisation: a callback URL is a bearer
   * secret in practice (its path often carries a token), so it never appears in polling
   * responses. Consumers see only whether one is configured and how the last attempt went.
   */
  webhook_url?: string;
  webhook_delivery?: WebhookDelivery;
  /**
   * @internal What the caller asked to be produced. Drives derived outputs (STEP is a
   * conversion of a mesh, not something a photogrammetry engine emits) and is echoed to
   * consumers as `output` so they can confirm what was promised.
   */
  output_spec?: ReconSubmitRequest["output"];
}

/**
 * Result of the single webhook attempt made when a job reaches a terminal state.
 *
 * v1 promises one attempt per terminal transition, not a retry loop: a delivery failure
 * is reported here so the caller can reconcile, and retries stay a v2 concern (adding them
 * later is not a breaking change — dropping a promise we made would be).
 */
export interface WebhookDelivery {
  status: "delivered" | "failed";
  http_status?: number;
  error?: string;
  at: string;
}


/**
 * Serialise a job for the wire. Internal fields are removed here, once, rather than
 * trusting every route to remember. Adding a field to ReconstructionJob does not
 * silently leak it to consumers.
 */
export function toPublicJob(job: ReconstructionJob): Record<string, unknown> {
  const clone: ReconstructionJob = { ...job };
  delete clone.input_snapshot;
  delete clone.provider_job_id;
  delete clone.webhook_url;
  delete clone.output_spec;
  // Presence and outcome are contract; the target itself is not.
  return {
    ...clone,
    usage: clone.usage ?? null,
    output: {
      formats: job.output_spec?.formats ?? ["stl"],
      units: job.output_spec?.units ?? "mm",
    },
    webhook: {
      configured: Boolean(job.webhook_url),
      last_delivery: job.webhook_delivery ?? null,
    },
  };
}

export interface ProviderCapabilities {
  id: string;
  version: string;
  /** false means submit will fail with ENGINE_NOT_AVAILABLE — never a fake success. */
  available: boolean;
  unavailable_reason?: string;
  inputs: string[];
  outputs: ReconOutputFormat[];
  needs_gpu: boolean;
  license: string;
}

export interface ProviderStatus {
  state: JobStatus;
  percent: number;
  stage?: string;
  message?: string;
}

export interface ProviderSubmitResult {
  providerJobId: string;
}

/**
 * The engine adapter boundary (rule 6). Implementations must be swappable without
 * touching the router, the contract files, or the frontend.
 */
export interface ReconstructionProvider {
  readonly id: string;
  readonly version: string;
  capabilities(): Promise<ProviderCapabilities>;
  submit(job: ReconstructionJob): Promise<ProviderSubmitResult>;
  status(providerJobId: string, job: ReconstructionJob): Promise<ProviderStatus>;
  cancel(providerJobId: string): Promise<void>;
  collect(providerJobId: string, job: ReconstructionJob): Promise<ReconOutput[]>;
}

/**
 * Capability errors are part of the contract: they carry a stable code string so
 * consumers can branch on them without string-matching our prose.
 */
export class CapabilityError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  toJSON(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }
}
