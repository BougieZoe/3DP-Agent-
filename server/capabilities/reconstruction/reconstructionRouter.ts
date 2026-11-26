/**
 * Photo-to-CAD capability router — the external contract surface.
 *
 *   POST /v1/reconstructions                        submit (202 Accepted)
 *   GET  /v1/reconstructions/:job_id                poll
 *   POST /v1/reconstructions/:job_id/cancel         cancel
 *   GET  /v1/reconstructions/:job_id/outputs/:fmt   download an open-format output
 *
 * Mounted twice by index.ts, together with createReconstructionCapabilityRouter():
 *   /v1/reconstructions            -> createReconstructionRouter()
 *   /v1/capabilities/reconstruction-> createReconstructionCapabilityRouter()
 *
 * Contract: docs/capability-open-standard-contract.md
 * Discipline: AGENTS.md -> "Hard rules — Open-Standard Capability Discipline"
 */
import path from "node:path";
import fs from "node:fs/promises";

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { FileJobStore } from "./jobStore.js";
import type { JobStore } from "./jobStore.js";
import { resolveTenantContext } from "./jobStore.js";
import { createProvider } from "./providerRegistry.js";
import { resolveStepExporter, stepExportDir } from "./exporters/step.js";
import type { StepExporter } from "./exporters/step.js";
import { buildEvent, deliverWebhook, eventTypeFor } from "./webhook.js";
import {
  CapabilityError,
  RECON_OUTPUT_FORMATS,
  TERMINAL_STATUSES,
  toPublicJob,
} from "./types.js";
import type {
  JobError,
  JobStatus,
  ReconOutput,
  ReconstructionJob,
  ReconstructionProvider,
  UsageRecord,
} from "./types.js";

const imageSchema = z.object({
  asset_id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
});

const submitSchema = z.object({
  tenant_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  input: z.object({
    images: z.array(imageSchema).min(1),
    scale_reference: z
      .object({ kind: z.string().min(1), known_mm: z.number().positive() })
      .optional(),
  }),
  output: z
    .object({
      formats: z.array(z.enum(RECON_OUTPUT_FORMATS)).min(1).optional(),
      units: z.enum(["mm", "cm", "in"]).optional(),
    })
    .optional(),
  engine_hint: z.string().min(1).optional(),
  webhook_url: z.string().url().optional(),
});

export interface ReconstructionRouterDeps {
  store: JobStore;
  provider: ReconstructionProvider;
  /** Root for job data and derived artefacts. Overridable in tests. */
  rootDir?: string;
  /** Injected by tests to avoid depending on a CAD kernel being installed. */
  stepExporter?: StepExporter;
  /** Injected by tests to observe deliveries without a network round trip. */
  deliver?: typeof deliverWebhook;
}

export function defaultDeps(): ReconstructionRouterDeps {
  const rootDir = process.env.RECON_DATA_DIR
    ? path.resolve(process.env.RECON_DATA_DIR)
    : path.resolve(process.cwd(), "server/data/capabilities/recon");
  return {
    store: new FileJobStore(rootDir),
    provider: createProvider({ workRoot: path.join(rootDir, "work") }),
    rootDir,
  };
}

/** Probe the CAD kernel once per router instance; probing shells out, so caching matters. */
interface StepExporterCache {
  current?: Promise<StepExporter>;
}

async function stepExporterFor(
  deps: ReconstructionRouterDeps,
  cache: StepExporterCache,
): Promise<StepExporter> {
  if (deps.stepExporter) return deps.stepExporter;
  cache.current ??= resolveStepExporter();
  return cache.current;
}

function secondsBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.round(ms / 1000));
}

function buildUsage(
  job: ReconstructionJob,
  status: JobStatus,
  outputs: ReconOutput[],
): UsageRecord {
  const finishedAt = new Date().toISOString();
  return {
    job_id: job.job_id,
    tenant_id: job.tenant_id,
    workspace_id: job.workspace_id,
    provider: job.engine.provider,
    provider_version: job.engine.version,
    images: job.input_snapshot?.images.length ?? 0,
    wall_seconds: secondsBetween(job.created_at, finishedAt),
    // GPU seconds are not measurable without engine-side telemetry; reporting a guess
    // here would corrupt billing data, so it stays null until the engine reports it.
    gpu_seconds: null,
    output_bytes: outputs.reduce((sum, item) => sum + item.bytes, 0),
    finished_at: finishedAt,
  };
}

/**
 * Convert the engine's mesh into STEP when the caller asked for it.
 *
 * A photogrammetry engine never emits STEP (it produces meshes, STEP is B-rep), so the
 * format is delivered by conversion. If the conversion is impossible the job must not claim
 * success: the caller asked for a manufacturable file, and handing back "succeeded" with a
 * missing format is the exact class of lie this capability must never tell. Mesh outputs are
 * still left on the job and stay downloadable, so nothing already produced is thrown away.
 */
async function deriveStepOutput(
  job: ReconstructionJob,
  deps: ReconstructionRouterDeps,
  cache: StepExporterCache,
): Promise<{ outputs: ReconOutput[]; error?: JobError }> {
  const formats = job.output_spec?.formats ?? ["stl"];
  if (!formats.includes("step")) return { outputs: job.outputs };
  if (job.outputs.some((item) => item.format === "step")) return { outputs: job.outputs };

  const source =
    job.outputs.find((item) => item.format === "stl") ??
    job.outputs.find((item) => item.format === "obj") ??
    job.outputs.find((item) => item.format === "glb");
  if (!source?.path) {
    return {
      outputs: job.outputs,
      error: {
        code: "STEP_EXPORT_FAILED",
        message: "No mesh output to convert into STEP.",
      },
    };
  }

  const exporter = await stepExporterFor(deps, cache);
  const availability = await exporter.availability();
  if (!availability.available) {
    return {
      outputs: job.outputs,
      error: {
        code: "STEP_EXPORT_FAILED",
        message: availability.unavailable_reason ?? "STEP export channel is unavailable.",
      },
    };
  }

  const outPath = path.join(
    stepExportDir(deps.rootDir ?? process.cwd()),
    `${job.job_id}.step`,
  );
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await exporter.convert({
      sourcePath: source.path,
      units: job.output_spec?.units ?? "mm",
      outPath,
    });
    const stat = await fs.stat(outPath);
    return {
      outputs: [
        ...job.outputs,
        { format: "step", path: outPath, bytes: stat.size, asset_id: `step_${job.job_id}` },
      ],
    };
  } catch (err) {
    return {
      outputs: job.outputs,
      error: {
        code: "STEP_EXPORT_FAILED",
        message: (err as Error).message,
      },
    };
  }
}

/**
 * Deliver the terminal event, once.
 *
 * `webhook_delivery` doubles as the "already attempted" marker, which is what makes this
 * idempotent across polls: a job may be settled repeatedly, but the consumer is told once.
 */
async function deliverTerminalEvent(
  job: ReconstructionJob,
  deps: ReconstructionRouterDeps,
): Promise<ReconstructionJob> {
  if (!job.webhook_url || job.webhook_delivery) return job;
  const type = eventTypeFor(job.status);
  if (!type) return job;

  const send = deps.deliver ?? deliverWebhook;
  const delivery = await send({
    url: job.webhook_url,
    event: buildEvent(type, job, toPublicJob(job)),
    secret: process.env.RECON_WEBHOOK_SECRET,
  });
  return deps.store.update(job.job_id, { webhook_delivery: delivery });
}

/** Refresh a running job from the provider and settle it once it reaches a terminal state. */
async function refreshJob(
  job: ReconstructionJob,
  deps: ReconstructionRouterDeps,
  cache: StepExporterCache,
): Promise<ReconstructionJob> {
  if (TERMINAL_STATUSES.includes(job.status) || !job.provider_job_id) {
    return deliverTerminalEvent(job, deps);
  }

  const status = await deps.provider.status(job.provider_job_id, job);
  if (status.state === "running" || status.state === "queued") {
    return deps.store.update(job.job_id, {
      status: status.state,
      progress: { stage: status.stage ?? job.progress.stage, percent: status.percent },
    });
  }

  let state: JobStatus = status.state;
  let error: JobError | undefined =
    status.state === "failed"
      ? { code: "ENGINE_FAILED", message: status.message ?? "Reconstruction failed." }
      : undefined;

  let outputs = status.state === "succeeded" ? await deps.provider.collect(job.provider_job_id, job) : [];
  if (status.state === "succeeded") {
    const derived = await deriveStepOutput({ ...job, outputs }, deps, cache);
    outputs = derived.outputs;
    if (derived.error) {
      state = "failed";
      error = derived.error;
    }
  }

  const usage = buildUsage(job, state, outputs);
  const updated = await deps.store.update(job.job_id, {
    status: state,
    progress: { stage: status.stage ?? state, percent: status.percent },
    outputs,
    usage,
    ...(error ? { error } : {}),
  });
  if (!job.usage) await deps.store.appendUsage(usage);
  return deliverTerminalEvent(updated, deps);
}

function sendCapabilityError(res: Response, err: CapabilityError): void {
  res.status(err.httpStatus).json({ error: err.toJSON() });
}

export function createReconstructionRouter(
  overrides: Partial<ReconstructionRouterDeps> = {},
): Router {
  const resolved = { ...defaultDeps(), ...overrides };
  const deps: ReconstructionRouterDeps = resolved;
  const cache: StepExporterCache = {};
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("x-capability", "photo-to-cad/v1");
    next();
  });

  router.post("/", async (req: Request, res: Response) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "REQUEST_INVALID",
          message: "Request body does not match the v1 contract.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    const body = parsed.data;
    const context = resolveTenantContext(body);
    const idempotencyKey =
      typeof req.header("idempotency-key") === "string"
        ? (req.header("idempotency-key") as string)
        : undefined;

    try {
      if (idempotencyKey) {
        const existing = await deps.store.findByIdempotencyKey(idempotencyKey);
        if (existing) {
          res
            .status(200)
            .setHeader("idempotency-replayed", "true")
            .json(toPublicJob(existing));
          return;
        }
      }

      const capabilities = await deps.provider.capabilities();
      if (!capabilities.available) {
        throw new CapabilityError(
          "ENGINE_NOT_AVAILABLE",
          capabilities.unavailable_reason ?? "Reconstruction engine is not available.",
          503,
        );
      }

      // Refuse before creating a job: a request we cannot honour must not leave a job id
      // behind for the caller to poll into a confusing failure.
      const requestedFormats = body.output?.formats ?? ["stl"];
      if (requestedFormats.includes("step")) {
        const exporter = await stepExporterFor(deps, cache);
        const availability = await exporter.availability();
        if (!availability.available) {
          throw new CapabilityError(
            "STEP_EXPORT_UNAVAILABLE",
            availability.unavailable_reason ??
              "STEP export was requested but no CAD kernel is available.",
            503,
          );
        }
      }

      const job = await deps.store.create({
        request: body,
        context,
        provider: { id: deps.provider.id, version: deps.provider.version },
        idempotency_key: idempotencyKey,
      });
      const withInputs = await deps.store.update(job.job_id, {
        input_snapshot: body.input,
        output_spec: body.output,
        ...(body.webhook_url ? { webhook_url: body.webhook_url } : {}),
      });

      try {
        const { providerJobId } = await deps.provider.submit(withInputs);
        const running = await deps.store.update(job.job_id, {
          status: "running",
          provider_job_id: providerJobId,
          progress: { stage: "starting", percent: 1 },
        });
        res.status(202).json(toPublicJob(running));
      } catch (err) {
        // The job is recorded as failed rather than erased: a refused submit is still a
        // fact about the request, and consumers can poll what happened to their job id.
        const capabilityError =
          err instanceof CapabilityError
            ? err
            : new CapabilityError("ENGINE_FAILED", (err as Error).message, 500);
        const usage = buildUsage(job, "failed", []);
        const failed = await deps.store.update(job.job_id, {
          status: "failed",
          error: capabilityError.toJSON(),
        });
        await deps.store.appendUsage(usage);
        await deliverTerminalEvent(failed, deps);
        res.status(capabilityError.httpStatus).json({
          error: capabilityError.toJSON(),
          job_id: job.job_id,
        });
      }
    } catch (err) {
      if (err instanceof CapabilityError) {
        sendCapabilityError(res, err);
        return;
      }
      res.status(500).json({ error: { code: "INTERNAL", message: (err as Error).message } });
    }
  });

  router.get("/:job_id", async (req: Request, res: Response) => {
    try {
      const job = await deps.store.get(req.params.job_id);
      if (!job) {
        res
          .status(404)
          .json({ error: { code: "JOB_NOT_FOUND", message: `No job ${req.params.job_id}` } });
        return;
      }
      res.json(toPublicJob(await refreshJob(job, deps, cache)));
    } catch (err) {
      if (err instanceof CapabilityError) {
        sendCapabilityError(res, err);
        return;
      }
      res.status(500).json({ error: { code: "INTERNAL", message: (err as Error).message } });
    }
  });

  router.post("/:job_id/cancel", async (req: Request, res: Response) => {
    try {
      const job = await deps.store.get(req.params.job_id);
      if (!job) {
        res
          .status(404)
          .json({ error: { code: "JOB_NOT_FOUND", message: `No job ${req.params.job_id}` } });
        return;
      }
      if (TERMINAL_STATUSES.includes(job.status)) {
        res.json(toPublicJob(job));
        return;
      }
      if (job.provider_job_id) await deps.provider.cancel(job.provider_job_id);
      const usage = buildUsage(job, "cancelled", []);
      const updated = await deps.store.update(job.job_id, {
        status: "cancelled",
        usage,
        progress: { stage: "cancelled", percent: job.progress.percent },
      });
      if (!job.usage) await deps.store.appendUsage(usage);
      res.status(202).json(toPublicJob(await deliverTerminalEvent(updated, deps)));
    } catch (err) {
      if (err instanceof CapabilityError) {
        sendCapabilityError(res, err);
        return;
      }
      res.status(500).json({ error: { code: "INTERNAL", message: (err as Error).message } });
    }
  });

  router.get("/:job_id/outputs/:format", async (req: Request, res: Response) => {
    try {
      const found = await deps.store.get(req.params.job_id);
      if (!found) {
        res
          .status(404)
          .json({ error: { code: "JOB_NOT_FOUND", message: `No job ${req.params.job_id}` } });
        return;
      }
      const job = await refreshJob(found, deps, cache);
      const format = req.params.format.toLowerCase();
      const output = job.outputs.find((item) => item.format === format);
      if (!output?.path) {
        res.status(404).json({
          error: {
            code: "OUTPUT_NOT_READY",
            message: `No ${format} output for ${job.job_id} (status: ${job.status}).`,
          },
        });
        return;
      }
      await fs.access(output.path);
      res.download(output.path, `${job.job_id}.${format}`);
    } catch (err) {
      if (err instanceof CapabilityError) {
        sendCapabilityError(res, err);
        return;
      }
      res.status(500).json({ error: { code: "INTERNAL", message: (err as Error).message } });
    }
  });

  return router;
}

/** Self-description endpoint: consumers discover formats and availability, not versions. */
export function createReconstructionCapabilityRouter(
  overrides: Partial<ReconstructionRouterDeps> = {},
): Router {
  const deps: ReconstructionRouterDeps = { ...defaultDeps(), ...overrides };
  const cache: StepExporterCache = {};
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const capabilities = await deps.provider.capabilities();
      const exporter = await stepExporterFor(deps, cache);
      const step = await exporter.availability();
      res.json({
        capability: "photo-to-cad",
        contract_version: "v1",
        ...capabilities,
        // Derived outputs are advertised separately from what the engine can emit: a
        // consumer needs to know STEP is a conversion that may be unavailable here, so it
        // can decide before submitting whether to ask for it.
        derived_outputs: {
          step: {
            available: step.available,
            kernel: step.kernel,
            ...(step.unavailable_reason ? { unavailable_reason: step.unavailable_reason } : {}),
          },
        },
        event_types: [
          "io.3dp.reconstruction.queued.v1",
          "io.3dp.reconstruction.succeeded.v1",
          "io.3dp.reconstruction.failed.v1",
          "io.3dp.reconstruction.cancelled.v1",
        ],
      });
    } catch (err) {
      res.status(500).json({ error: { code: "INTERNAL", message: (err as Error).message } });
    }
  });

  return router;
}
