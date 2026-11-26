/**
 * Apple Object Capture provider (macOS 12+, Apple silicon or Intel with a Metal GPU).
 *
 * Why it exists: COLMAP's dense stereo needs CUDA. On Apple silicon that means a
 * COLMAP-only install can register cameras but can never produce a mesh, so the
 * photo-to-CAD promise ("photos in, mesh out") could not be kept. Object Capture runs on
 * Metal on the same machine and closes the gap. Per rule 6 the engine is swappable; the
 * request and response shapes do not move.
 *
 * Two processes are involved, both compiled from the Swift sources next to this file:
 * - applePhotogrammetry: photos -> USDZ mesh
 * - appleMeshConvert: USDZ -> binary STL (Object Capture cannot write STL itself)
 *
 * Scale: Object Capture reconstructs at an arbitrary scale, like COLMAP, so a
 * `scale_reference` cannot be honoured and is refused rather than silently ignored.
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

const execFileAsync = promisify(execFile);

const DETAILS = new Set(["preview", "reduced", "medium", "full", "raw"]);

interface ProviderMeta {
  pid: number;
  work_dir: string;
  usdz_path: string;
  progress_path: string;
  stderr_log: string;
  started_at: string;
}

interface Progress {
  stage: string;
  percent: number;
  error?: string;
  mesh?: string;
  bytes?: number;
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

export class ApplePhotogrammetryProvider implements ReconstructionProvider {
  readonly id = "apple";
  readonly version: string;

  private readonly workRoot: string;
  private readonly binDir: string;
  private readonly sourceDir: string;
  private readonly detail: string;
  private compilePromise?: Promise<void>;
  private versionPromise?: Promise<string>;

  constructor(options: { workRoot: string; binDir?: string; detail?: string; version?: string }) {
    this.workRoot = options.workRoot;
    this.binDir = options.binDir ?? path.join(options.workRoot, "..", "bin");
    this.sourceDir = path.dirname(fileURLToPath(import.meta.url));
    const requested = options.detail ?? process.env.RECON_APPLE_DETAIL ?? "medium";
    // An unknown detail level would otherwise fall through to Swift's default branch and
    // produce a mesh of a quality nobody asked for.
    this.detail = DETAILS.has(requested) ? requested : "medium";
    this.version = options.version ?? process.env.RECON_APPLE_VERSION ?? "unknown";
  }

  private binary(name: "applePhotogrammetry" | "appleMeshConvert"): string {
    return path.join(this.binDir, name);
  }

  private async swiftcAvailable(): Promise<boolean> {
    try {
      await execFileAsync("xcrun", ["--find", "swiftc"], { timeout: 20_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async osVersion(): Promise<string> {
    if (this.version !== "unknown") return this.version;
    if (!this.versionPromise) {
      this.versionPromise = execFileAsync("sw_vers", ["-productVersion"], { timeout: 10_000 })
        .then(({ stdout }) => `macOS ${stdout.trim()}`)
        .catch(() => "unknown");
    }
    return this.versionPromise;
  }

  /**
   * Compile on first use, and recompile when the Swift source changes. Shipping a
   * prebuilt binary would break the moment the sources move; compiling here keeps the
   * engine honest about matching its source.
   */
  private async ensureBinaries(): Promise<void> {
    if (!this.compilePromise) {
      this.compilePromise = (async () => {
        await fs.mkdir(this.binDir, { recursive: true });
        const targets: Array<{ source: string; output: string }> = [
          { source: path.join(this.sourceDir, "applePhotogrammetry.swift"), output: this.binary("applePhotogrammetry") },
          { source: path.join(this.sourceDir, "appleMeshConvert.swift"), output: this.binary("appleMeshConvert") },
        ];
        for (const target of targets) {
          const [sourceStat, outputStat] = await Promise.all([
            fs.stat(target.source),
            fs.stat(target.output).catch(() => null),
          ]);
          if (outputStat && outputStat.mtimeMs >= sourceStat.mtimeMs) continue;
          await execFileAsync("swiftc", ["-O", "-o", target.output, target.source], { timeout: 180_000 });
        }
      })().catch((err) => {
        // Let the next call retry: a transient compile failure should not poison the
        // provider for the lifetime of the process.
        this.compilePromise = undefined;
        throw err;
      });
    }
    return this.compilePromise;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const base = {
      id: this.id,
      inputs: ["image_set"],
      outputs: ["stl" as const],
      // Object Capture does not need CUDA, but it does need a Metal GPU, which every
      // supported Mac has. The flag describes the CUDA-style external requirement.
      needs_gpu: false,
      license: "Apple Object Capture (Proprietary SDK, royalty-free on Apple platforms)",
    };

    if (process.platform !== "darwin") {
      return {
        ...base,
        version: this.version,
        available: false,
        unavailable_reason: "Object Capture is a macOS-only framework; use RECON_PROVIDER=colmap or meshroom on this host.",
      };
    }
    if (!(await this.swiftcAvailable())) {
      return {
        ...base,
        version: this.version,
        available: false,
        unavailable_reason:
          "Apple Object Capture needs the Swift toolchain to build its driver; install Xcode Command Line Tools ('xcode-select --install').",
      };
    }

    return { ...base, version: await this.osVersion(), available: true };
  }

  private jobDir(job: ReconstructionJob): string | null {
    if (!job?.job_id || !this.workRoot) return null;
    return path.join(this.workRoot, job.job_id);
  }

  async submit(job: ReconstructionJob): Promise<ProviderSubmitResult> {
    const capabilities = await this.capabilities();
    if (!capabilities.available) {
      throw new CapabilityError(
        "ENGINE_NOT_AVAILABLE",
        capabilities.unavailable_reason ?? "Object Capture is not available on this host.",
        503,
      );
    }

    const workDir = this.jobDir(job);
    if (!workDir) throw new CapabilityError("REQUEST_INVALID", "Job has no job_id; refusing to run.", 400);

    const snapshot = job.input_snapshot;
    if (snapshot?.scale_reference) {
      throw new CapabilityError(
        "SCALE_REFERENCE_UNSUPPORTED",
        "Object Capture reconstructs at an arbitrary scale and cannot honour scale_reference; " +
          "omit it until marker-based scale calibration ships.",
        422,
      );
    }

    const imagesDir = path.join(workDir, "images");
    await fs.mkdir(imagesDir, { recursive: true });

    let collected = 0;
    for (const image of snapshot?.images ?? []) {
      if (!image.path) continue;
      if (!(await exists(image.path))) {
        throw new CapabilityError("INPUT_NOT_FOUND", `Image asset not found on this host: ${image.path}`, 422);
      }
      await fs.copyFile(image.path, path.join(imagesDir, path.basename(image.path)));
      collected += 1;
    }
    if (collected < 3) {
      throw new CapabilityError(
        "INPUT_INSUFFICIENT",
        `Object Capture needs at least 3 photos of the same object from different angles; received ${collected}.`,
        422,
      );
    }

    await this.ensureBinaries();

    const usdzPath = path.join(workDir, "mesh.usdz");
    const progressPath = path.join(workDir, "progress.json");
    const stderrLog = path.join(workDir, "engine.log");

    const child = spawn(
      this.binary("applePhotogrammetry"),
      [imagesDir, usdzPath, progressPath, this.detail],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] },
    );

    const errStream = await fs.open(stderrLog, "a");
    child.stderr?.on("data", (chunk: Buffer) => void errStream.write(chunk));
    child.on("close", () => void errStream.close());

    const pid = child.pid;
    if (!pid) throw new CapabilityError("ENGINE_FAILED", "Object Capture driver failed to start.", 500);

    const meta: ProviderMeta = {
      pid,
      work_dir: workDir,
      usdz_path: usdzPath,
      progress_path: progressPath,
      stderr_log: stderrLog,
      started_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(workDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    child.unref();

    return { providerJobId: `${job.job_id}:${pid}` };
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  private async logTail(file: string, maxBytes = 2048): Promise<string> {
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

  /** Object Capture writes USDZ only; the contract promises STL, so convert once here. */
  private async ensureStl(job: ReconstructionJob): Promise<ReconOutput[]> {
    const dir = this.jobDir(job);
    if (!dir) return [];
    const stlPath = path.join(dir, "output", "mesh.stl");
    if (await exists(stlPath)) {
      const stat = await fs.stat(stlPath);
      return [{ format: "stl", path: stlPath, bytes: stat.size }];
    }
    const usdzPath = path.join(dir, "mesh.usdz");
    if (!(await exists(usdzPath))) return [];

    await this.ensureBinaries();
    await fs.mkdir(path.join(dir, "output"), { recursive: true });
    try {
      await execFileAsync(this.binary("appleMeshConvert"), [usdzPath, stlPath], { timeout: 300_000 });
    } catch (err) {
      throw new CapabilityError(
        "OUTPUT_CONVERSION_FAILED",
        `The mesh was reconstructed but USDZ -> STL conversion failed: ${(err as Error).message}`,
        500,
      );
    }
    const stat = await fs.stat(stlPath);
    return [{ format: "stl", path: stlPath, bytes: stat.size }];
  }

  async status(_providerJobId: string, job: ReconstructionJob): Promise<ProviderStatus> {
    const dir = this.jobDir(job);
    if (!dir) throw new CapabilityError("JOB_STATE_LOST", "Job has no working directory.", 409);
    const meta = await this.readJson<ProviderMeta>(path.join(dir, "meta.json"));
    if (!meta) {
      throw new CapabilityError("JOB_STATE_LOST", "No provider state on disk for this job.", 409);
    }
    const progress = await this.readJson<Progress>(meta.progress_path);
    const percent = progress?.percent ?? 5;
    const stage = progress?.stage ?? "starting";

    if (isProcessAlive(meta.pid)) {
      return { state: "running", percent, stage };
    }

    if (progress?.stage === "failed" || progress?.error) {
      const log = await this.logTail(meta.stderr_log);
      return {
        state: "failed",
        percent,
        stage,
        message: `${progress?.error ?? "Object Capture failed."}${log ? `\n${log.slice(-500)}` : ""}`.trim(),
      };
    }

    try {
      const outputs = await this.ensureStl(job);
      if (outputs.length > 0) {
        return { state: "succeeded", percent: 100, stage: "completed" };
      }
    } catch (err) {
      return { state: "failed", percent, stage: "conversion", message: (err as Error).message };
    }

    return {
      state: "failed",
      percent,
      stage,
      message:
        (await this.logTail(meta.stderr_log)).slice(-600) ||
        "Object Capture exited without producing a mesh.",
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    const pid = Number.parseInt(providerJobId.split(":").pop() ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new CapabilityError("JOB_NOT_FOUND", `Unknown provider job ${providerJobId}`, 404);
    }
    try {
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
