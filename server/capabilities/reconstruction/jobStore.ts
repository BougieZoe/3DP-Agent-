/**
 * Job store for the Photo-to-CAD capability.
 *
 * Deliberately dumb: one JSON file per job + an append-only usage ledger. Rule 5 says
 * every job emits a usage record, so the ledger write lives here where it cannot be
 * forgotten by a caller. Swapping this for Postgres later changes no contract.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ReconstructionJob,
  UsageRecord,
  ReconSubmitRequest,
  TenantContext,
} from "./types.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "./types.js";

export interface CreateJobInput {
  request: ReconSubmitRequest;
  context: TenantContext;
  provider: { id: string; version: string };
  idempotency_key?: string;
}

export interface JobStore {
  create(input: CreateJobInput): Promise<ReconstructionJob>;
  get(jobId: string): Promise<ReconstructionJob | null>;
  update(jobId: string, patch: Partial<ReconstructionJob>): Promise<ReconstructionJob>;
  findByIdempotencyKey(key: string): Promise<ReconstructionJob | null>;
  appendUsage(record: UsageRecord): Promise<void>;
  listUsage(): Promise<UsageRecord[]>;
}

export function newJobId(): string {
  return `job_${randomBytes(6).toString("hex")}`;
}

/**
 * Tenant context resolution (rule 4). Missing values default to "local"; we never
 * emit an undefined tenant and never reject a request just because it omitted them.
 */
export function resolveTenantContext(request: ReconSubmitRequest): TenantContext {
  const tenant = request.tenant_id?.trim();
  const workspace = request.workspace_id?.trim();
  return {
    tenant_id: tenant && tenant.length > 0 ? tenant : DEFAULT_TENANT_ID,
    workspace_id: workspace && workspace.length > 0 ? workspace : DEFAULT_WORKSPACE_ID,
  };
}

function idempotencyFileName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.key`;
}

/** Filesystem-backed store; the default for a single-user local install. */
export class FileJobStore implements JobStore {
  private readonly jobsDir: string;
  private readonly idemDir: string;
  private readonly usageFile: string;

  constructor(rootDir: string) {
    this.jobsDir = path.join(rootDir, "jobs");
    this.idemDir = path.join(rootDir, "idempotency");
    this.usageFile = path.join(rootDir, "usage.jsonl");
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    await fs.mkdir(this.idemDir, { recursive: true });
  }

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  }

  async create(input: CreateJobInput): Promise<ReconstructionJob> {
    await this.ensureDirs();
    const now = new Date().toISOString();
    const job: ReconstructionJob = {
      job_id: newJobId(),
      tenant_id: input.context.tenant_id,
      workspace_id: input.context.workspace_id,
      status: "queued",
      progress: { stage: "queued", percent: 0 },
      engine: { provider: input.provider.id, version: input.provider.version },
      outputs: [],
      usage: null,
      created_at: now,
      updated_at: now,
    };
    if (input.idempotency_key) {
      job.idempotency_key = input.idempotency_key;
    }
    await this.writeJsonAtomic(this.jobPath(job.job_id), job);
    if (input.idempotency_key) {
      await this.writeJsonAtomic(
        path.join(this.idemDir, idempotencyFileName(input.idempotency_key)),
        { job_id: job.job_id },
      );
    }
    return job;
  }

  async get(jobId: string): Promise<ReconstructionJob | null> {
    // Only accept ids we generated: prevents path traversal through the URL segment.
    if (!/^job_[0-9a-f]{12}$/.test(jobId)) return null;
    try {
      const raw = await fs.readFile(this.jobPath(jobId), "utf8");
      return JSON.parse(raw) as ReconstructionJob;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async update(
    jobId: string,
    patch: Partial<ReconstructionJob>,
  ): Promise<ReconstructionJob> {
    const current = await this.get(jobId);
    if (!current) throw new Error(`job not found: ${jobId}`);
    const next: ReconstructionJob = {
      ...current,
      ...patch,
      job_id: current.job_id,
      created_at: current.created_at,
      tenant_id: current.tenant_id,
      workspace_id: current.workspace_id,
      updated_at: new Date().toISOString(),
    };
    await this.writeJsonAtomic(this.jobPath(jobId), next);
    return next;
  }

  async findByIdempotencyKey(key: string): Promise<ReconstructionJob | null> {
    try {
      const raw = await fs.readFile(
        path.join(this.idemDir, idempotencyFileName(key)),
        "utf8",
      );
      const { job_id: jobId } = JSON.parse(raw) as { job_id?: string };
      if (!jobId) return null;
      return await this.get(jobId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async appendUsage(record: UsageRecord): Promise<void> {
    await this.ensureDirs();
    await fs.appendFile(this.usageFile, `${JSON.stringify(record)}\n`, "utf8");
  }

  async listUsage(): Promise<UsageRecord[]> {
    try {
      const raw = await fs.readFile(this.usageFile, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as UsageRecord);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}
