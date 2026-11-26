/**
 * COLMAP provider (BSD-3-Clause — no AGPL anywhere in the capability layer).
 *
 * Why this exists next to the Meshroom adapter: Meshroom stopped shipping a macOS build,
 * and the contract is engine-agnostic by design (rule 6). Adding an engine must never
 * change what an external caller sees, so this file only fills in
 * `ReconstructionProvider` and nothing above it moves.
 *
 * Honest limits, stated up front rather than discovered by a customer:
 * - The Homebrew COLMAP bottle is CPU-only, so a job takes minutes, not seconds.
 * - COLMAP reconstructs in an arbitrary scale. A `scale_reference` therefore cannot be
 *   honoured, and asking for one is refused instead of returning a part of unknown size.
 * - Output is STL. STEP stays a derived output owned by the CAD-kernel exporter.
 */
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CapabilityError } from "../types.js";
import type {
  ProviderCapabilities,
  ProviderStatus,
  ProviderSubmitResult,
  ReconOutput,
  ReconstructionJob,
  ReconstructionProvider,
} from "../types.js";
import { plyFileToStl } from "./ply.js";

const execFileAsync = promisify(execFile);

const CANDIDATE_BINARIES = [
  "/opt/homebrew/bin/colmap",
  "/usr/local/bin/colmap",
  "/usr/bin/colmap",
];

interface ProviderMeta {
  pid: number;
  work_dir: string;
  stdout_log: string;
  stderr_log: string;
  started_at: string;
  pipeline: string;
}

interface PipelineProgress {
  stage: string;
  percent: number;
  step_index?: number;
  steps_total?: number;
  error?: string;
  updated_at?: string;
  failed_at?: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class ColmapProvider implements ReconstructionProvider {
  readonly id = "colmap";
  readonly version: string;

  private readonly workRoot: string;
  private readonly binOverride?: string;
  private versionPromise?: Promise<string>;

  constructor(options: { workRoot: string; binPath?: string; version?: string }) {
    this.workRoot = options.workRoot;
    this.binOverride = options.binPath ?? process.env.RECON_COLMAP_BIN;
    this.version = options.version ?? process.env.RECON_COLMAP_VERSION ?? "unknown";
  }

  async resolveBinary(): Promise<string | null> {
    if (this.binOverride && (await exists(this.binOverride))) return this.binOverride;
    for (const candidate of CANDIDATE_BINARIES) {
      if (await exists(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Read the real version string instead of trusting a hard-coded one, and learn from it
   * whether this build can do GPU work — `needs_gpu` is a capability claim, so it must come
   * from the binary, not from what we wish were installed.
   */
  private async detectVersion(binary: string): Promise<string> {
    if (this.version !== "unknown") return this.version;
    if (!this.versionPromise) {
      this.versionPromise = execFileAsync(binary, ["--version"], { timeout: 20_000 })
        .then(({ stdout, stderr }) => {
          const firstLine = `${stdout}\n${stderr}`.split("\n").find((line) => line.trim().length > 0);
          const match = /COLMAP\s+([0-9][^\s(]*)/i.exec(firstLine ?? "");
          return match?.[1] ?? "unknown";
        })
        .catch(() => "unknown");
    }
    return this.versionPromise;
  }

  private async hasGpuSupport(binary: string): Promise<boolean> {
    try {
      const { stdout, stderr } = await execFileAsync(binary, ["--version"], { timeout: 20_000 });
      return !/without GPU support/i.test(`${stdout}${stderr}`);
    } catch {
      return false;
    }
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const binary = await this.resolveBinary();
    if (!binary) {
      return {
        id: this.id,
        version: this.version,
        available: false,
        unavailable_reason: "colmap not found; set RECON_COLMAP_BIN or install COLMAP ('brew install colmap').",
        inputs: ["image_set"],
        outputs: ["stl"],
        needs_gpu: false,
        license: "BSD-3-Clause (COLMAP)",
      };
    }
    const gpuSupport = await this.hasGpuSupport(binary);
    if (!gpuSupport) {
      // Measured here, not guessed: a CPU-only COLMAP build registers cameras fine and then
      // aborts in depth_maps, so accepting the job would waste the customer's upload and
      // leave a half-finished workspace. Better to say so before taking work.
      return {
        id: this.id,
        version: await this.detectVersion(binary),
        available: false,
        unavailable_reason:
          "This COLMAP build has no CUDA support, so dense stereo cannot produce a mesh on this host. " +
          "Install a CUDA-enabled COLMAP, or use RECON_PROVIDER=apple on macOS.",
        inputs: ["image_set"],
        outputs: ["stl"],
        needs_gpu: false,
        license: "BSD-3-Clause (COLMAP)",
      };
    }
    return {
      id: this.id,
      version: await this.detectVersion(binary),
      available: true,
      inputs: ["image_set"],
      outputs: ["stl"],
      needs_gpu: true,
      license: "BSD-3-Clause (COLMAP)",
    };
  }

  private jobDir(job: ReconstructionJob): string | null {
    if (!job?.job_id || !this.workRoot) return null;
    return path.join(this.workRoot, job.job_id);
  }

  private pipelineScript(): string {
    // Resolved relative to this module so a relocated checkout still works.
    return path.join(path.dirname(fileURLToPath(import.meta.url)), "colmapPipeline.mjs");
  }

  async submit(job: ReconstructionJob): Promise<ProviderSubmitResult> {
    const capabilities = await this.capabilities();
    if (!capabilities.available) {
      throw new CapabilityError(
        "ENGINE_NOT_AVAILABLE",
        capabilities.unavailable_reason ?? "COLMAP is not usable on this host.",
        503,
      );
    }
    const binary = await this.resolveBinary();
    if (!binary) {
      throw new CapabilityError(
        "ENGINE_NOT_AVAILABLE",
        "No COLMAP binary available on this host; the reconstruction engine is not installed.",
        503,
      );
    }

    const workDir = this.jobDir(job);
    if (!workDir) throw new CapabilityError("REQUEST_INVALID", "Job has no job_id; refusing to run.", 400);

    const snapshot = job.input_snapshot;
    if (snapshot?.scale_reference) {
      // COLMAP reconstructs at an arbitrary scale. Returning a part with no proven size
      // would be worse than refusing: it would look successful and print wrong.
      throw new CapabilityError(
        "SCALE_REFERENCE_UNSUPPORTED",
        "The COLMAP engine reconstructs in arbitrary units and cannot honour scale_reference; " +
          "omit it, or use an engine that performs marker-based scale calibration.",
        422,
      );
    }

    const imagesDir = path.join(workDir, "images");
    await fs.mkdir(imagesDir, { recursive: true });

    let collected = 0;
    for (const image of snapshot?.images ?? []) {
      if (!image.path) continue;
      if (!(await exists(image.path))) {
        throw new CapabilityError(
          "INPUT_NOT_FOUND",
          `Image asset not found on this host: ${image.path}`,
          422,
        );
      }
      await fs.copyFile(image.path, path.join(imagesDir, path.basename(image.path)));
      collected += 1;
    }
    if (collected < 2) {
      throw new CapabilityError(
        "INPUT_INSUFFICIENT",
        `Photo-to-CAD needs at least 2 overlapping images; received ${collected}.`,
        422,
      );
    }

    const stdoutLog = path.join(workDir, "stdout.log");
    const stderrLog = path.join(workDir, "stderr.log");
    const pipeline = this.pipelineScript();

    const child = spawn(process.execPath, [pipeline, binary, workDir], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const outStream = await fs.open(stdoutLog, "a");
    const errStream = await fs.open(stderrLog, "a");
    child.stdout?.on("data", (chunk: Buffer) => void outStream.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => void errStream.write(chunk));
    child.on("close", () => {
      void outStream.close();
      void errStream.close();
    });

    const pid = child.pid;
    if (!pid) {
      throw new CapabilityError("ENGINE_FAILED", "COLMAP pipeline failed to start.", 500);
    }
    const meta: ProviderMeta = {
      pid,
      work_dir: workDir,
      stdout_log: stdoutLog,
      stderr_log: stderrLog,
      started_at: new Date().toISOString(),
      pipeline,
    };
    await fs.writeFile(path.join(workDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    child.unref();

    return { providerJobId: `${job.job_id}:${pid}` };
  }

  private async readMeta(job: ReconstructionJob): Promise<ProviderMeta | null> {
    const dir = this.jobDir(job);
    if (!dir) return null;
    try {
      return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")) as ProviderMeta;
    } catch {
      return null;
    }
  }

  private async readProgress(job: ReconstructionJob): Promise<PipelineProgress | null> {
    const dir = this.jobDir(job);
    if (!dir) return null;
    try {
      return JSON.parse(await fs.readFile(path.join(dir, "progress.json"), "utf8")) as PipelineProgress;
    } catch {
      return null;
    }
  }

  private async readLogTail(file: string, maxBytes = 4096): Promise<string> {
    try {
      const handle = await fs.open(file, "r");
      try {
        const stat = await handle.stat();
        const start = Math.max(0, stat.size - maxBytes);
        const buffer = Buffer.alloc(stat.size - start);
        await handle.read(buffer, 0, buffer.length, start);
        return buffer.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return "";
    }
  }

  /** Locate the mesh COLMAP produced, preferring the poisson result. */
  private async findMesh(job: ReconstructionJob): Promise<string | null> {
    const dir = this.jobDir(job);
    if (!dir) return null;
    const candidates = [
      path.join(dir, "output", "mesh.ply"),
      path.join(dir, "dense", "meshed-poisson.ply"),
      path.join(dir, "dense", "meshed-delaunay.ply"),
    ];
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Convert the engine mesh to STL once, on demand. Conversion failure is surfaced as a
   * failed job with a reason — a job is never "succeeded" with an output nobody can open.
   */
  private async ensureStl(job: ReconstructionJob): Promise<ReconOutput[]> {
    const dir = this.jobDir(job);
    if (!dir) return [];
    const stlPath = path.join(dir, "output", "mesh.stl");
    if (await exists(stlPath)) {
      const stat = await fs.stat(stlPath);
      return [{ format: "stl", path: stlPath, bytes: stat.size }];
    }
    const plyPath = await this.findMesh(job);
    if (!plyPath) return [];
    const { bytes } = await plyFileToStl(plyPath, stlPath);
    return [{ format: "stl", path: stlPath, bytes }];
  }

  async status(providerJobId: string, job: ReconstructionJob): Promise<ProviderStatus> {
    const meta = await this.readMeta(job);
    if (!meta) {
      throw new CapabilityError("JOB_STATE_LOST", `No provider state on disk for ${providerJobId}.`, 409);
    }
    const progress = await this.readProgress(job);
    const percent = progress?.percent ?? 5;
    const stage = progress?.stage ?? "starting";

    if (isProcessAlive(meta.pid)) {
      return { state: "running", percent, stage };
    }

    if (progress?.error) {
      const log = await this.readLogTail(meta.stderr_log);
      return {
        state: "failed",
        percent,
        stage,
        message: `${progress.error}${log ? `\n${log.slice(-600)}` : ""}`.trim(),
      };
    }

    try {
      const outputs = await this.ensureStl(job);
      if (outputs.length > 0) {
        return { state: "succeeded", percent: 100, stage: "completed" };
      }
    } catch (err) {
      return {
        state: "failed",
        percent,
        stage: "conversion",
        message: `Reconstruction finished but the mesh could not be converted to STL: ${(err as Error).message}`,
      };
    }

    const log = await this.readLogTail(meta.stderr_log);
    return {
      state: "failed",
      percent,
      stage,
      message: log.slice(-800) || "COLMAP exited without producing a mesh.",
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    const pid = Number.parseInt(providerJobId.split(":").pop() ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new CapabilityError("JOB_NOT_FOUND", `Unknown provider job ${providerJobId}`, 404);
    }
    try {
      // Negative pid targets the process group: the pipeline spawns colmap children, and
      // signalling only the parent would leave an orphan chewing CPU for minutes.
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return;
        throw err;
      }
    }
  }

  async collect(_providerJobId: string, job: ReconstructionJob): Promise<ReconOutput[]> {
    return this.ensureStl(job);
  }
}
