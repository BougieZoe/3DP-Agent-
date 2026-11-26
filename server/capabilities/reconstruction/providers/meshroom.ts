/**
 * Meshroom / AliceVision provider (MIT / BSD family — no AGPL in the capability layer).
 *
 * Runs `meshroom_batch` as an independent child process. Everything it needs is derived
 * from the job, so the same payload could be forwarded to a remote worker instead
 * (rule 8: data-plane separability) without touching the contract.
 *
 * If no Meshroom binary is found, `capabilities().available` is false and submit fails
 * with ENGINE_NOT_AVAILABLE. It never fabricates a job or an output (rule 10).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { CapabilityError } from "../types.js";
import type {
  ProviderCapabilities,
  ProviderStatus,
  ProviderSubmitResult,
  ReconOutput,
  ReconstructionJob,
  ReconstructionProvider,
} from "../types.js";

const CANDIDATE_BINARIES = [
  "/Applications/Meshroom.app/Contents/MacOS/meshroom_batch",
  "/opt/homebrew/bin/meshroom_batch",
  "/usr/local/bin/meshroom_batch",
  "/usr/bin/meshroom_batch",
];

const STAGE_HINTS: Array<{ pattern: RegExp; stage: string; percent: number }> = [
  { pattern: /CameraInit|FeatureExtraction/i, stage: "feature_extraction", percent: 15 },
  { pattern: /ImageMatching|FeatureMatching/i, stage: "feature_matching", percent: 30 },
  { pattern: /StructureFromMotion/i, stage: "structure_from_motion", percent: 45 },
  { pattern: /DepthMap/i, stage: "depth_maps", percent: 60 },
  { pattern: /Meshing/i, stage: "meshing", percent: 75 },
  { pattern: /MeshFiltering/i, stage: "mesh_filtering", percent: 85 },
  { pattern: /Texturing/i, stage: "texturing", percent: 95 },
];

const MESH_EXTENSIONS: Record<string, ReconOutput["format"]> = {
  ".stl": "stl",
  ".obj": "obj",
  ".glb": "glb",
  ".gltf": "glb",
  ".step": "step",
  ".stp": "step",
  ".3mf": "3mf",
};

interface ProviderMeta {
  pid: number;
  work_dir: string;
  stdout_log: string;
  stderr_log: string;
  started_at: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export class MeshroomProvider implements ReconstructionProvider {
  readonly id = "meshroom";
  readonly version: string;

  private readonly workRoot: string;
  private binOverride?: string;

  constructor(options: { workRoot: string; binPath?: string; version?: string }) {
    this.workRoot = options.workRoot;
    this.binOverride = options.binPath ?? process.env.RECON_MESHROOM_BIN;
    this.version = options.version ?? process.env.RECON_MESHROOM_VERSION ?? "unknown";
  }

  /** Resolve the CLI without invoking a shell; returns null when Meshroom is absent. */
  async resolveBinary(): Promise<string | null> {
    if (this.binOverride && (await exists(this.binOverride))) return this.binOverride;
    for (const candidate of CANDIDATE_BINARIES) {
      if (await exists(candidate)) return candidate;
    }
    return null;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const binary = await this.resolveBinary();
    return {
      id: this.id,
      version: this.version,
      available: binary !== null,
      ...(binary === null
        ? {
            unavailable_reason:
              "meshroom_batch not found; set RECON_MESHROOM_BIN or install Meshroom",
          }
        : {}),
      inputs: ["image_set", "scale_reference"],
      outputs: ["step", "stl", "glb", "obj"],
      needs_gpu: true,
      license: "MIT / BSD family (AliceVision, Meshroom)",
    };
  }

  private jobDir(job: ReconstructionJob): string {
    return path.join(this.workRoot, job.job_id);
  }

  async submit(job: ReconstructionJob): Promise<ProviderSubmitResult> {
    const binary = await this.resolveBinary();
    if (!binary) {
      throw new CapabilityError(
        "ENGINE_NOT_AVAILABLE",
        "No Meshroom binary available on this host; the reconstruction engine is not installed.",
        503,
      );
    }

    const workDir = this.jobDir(job);
    const inputsDir = path.join(workDir, "images");
    await fs.mkdir(inputsDir, { recursive: true });

    // Local provider only: inputs must be real files reachable by this process.
    let collected = 0;
    for (const image of job.input_snapshot?.images ?? []) {
      if (!image.path) continue;
      if (!(await exists(image.path))) {
        throw new CapabilityError(
          "INPUT_NOT_FOUND",
          `Image asset not found on this host: ${image.path}`,
          422,
        );
      }
      const target = path.join(inputsDir, path.basename(image.path));
      await fs.copyFile(image.path, target);
      collected += 1;
    }
    if (collected < 2) {
      throw new CapabilityError(
        "INPUT_INSUFFICIENT",
        `Photo-to-CAD needs at least 2 images; received ${collected}.`,
        422,
      );
    }

    const cacheDir = path.join(workDir, "cache");
    const outputMesh = path.join(workDir, "output", "mesh.mg");
    const stdoutLog = path.join(workDir, "stdout.log");
    const stderrLog = path.join(workDir, "stderr.log");
    await fs.mkdir(path.dirname(outputMesh), { recursive: true });

    const child = spawn(
      binary,
      ["--input", inputsDir, "--output", outputMesh, "--cache", cacheDir],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    const outStream = await fs.open(stdoutLog, "a");
    const errStream = await fs.open(stderrLog, "a");
    child.stdout?.on("data", (chunk: Buffer) => {
      void outStream.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      void errStream.write(chunk);
    });
    child.on("close", () => {
      void outStream.close();
      void errStream.close();
    });

    const pid = child.pid;
    if (!pid) {
      throw new CapabilityError("ENGINE_FAILED", "Meshroom process failed to start.", 500);
    }
    const meta: ProviderMeta = {
      pid,
      work_dir: workDir,
      stdout_log: stdoutLog,
      stderr_log: stderrLog,
      started_at: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(workDir, "meta.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    );
    child.unref();

    return { providerJobId: `${job.job_id}:${pid}` };
  }

  private async readMeta(job: ReconstructionJob): Promise<ProviderMeta | null> {
    try {
      const raw = await fs.readFile(path.join(this.jobDir(job), "meta.json"), "utf8");
      return JSON.parse(raw) as ProviderMeta;
    } catch {
      return null;
    }
  }

  private async readLogTail(file: string, maxBytes = 8192): Promise<string> {
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

  async status(providerJobId: string, job: ReconstructionJob): Promise<ProviderStatus> {
    const meta = await this.readMeta(job);
    if (!meta) {
      throw new CapabilityError(
        "JOB_STATE_LOST",
        `No provider state on disk for ${providerJobId}.`,
        409,
      );
    }

    const outputs = await this.collect(providerJobId, job);
    const log = `${await this.readLogTail(meta.stdout_log)}${await this.readLogTail(
      meta.stderr_log,
    )}`;

    let stage = "running";
    let percent = 5;
    for (const hint of STAGE_HINTS) {
      if (hint.pattern.test(log)) {
        stage = hint.stage;
        percent = hint.percent;
      }
    }

    if (!isProcessAlive(meta.pid)) {
      if (outputs.length > 0) {
        return { state: "succeeded", percent: 100, stage: "completed" };
      }
      return {
        state: "failed",
        percent,
        stage,
        message: log.slice(-800) || "Meshroom exited without producing a mesh.",
      };
    }

    return { state: "running", percent, stage };
  }

  async cancel(providerJobId: string): Promise<void> {
    const pid = Number.parseInt(providerJobId.split(":").pop() ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new CapabilityError("JOB_NOT_FOUND", `Unknown provider job ${providerJobId}`, 404);
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return;
      throw err;
    }
  }

  /** Walk the output tree for open-format meshes; returns file facts, not promises. */
  async collect(_providerJobId: string, job: ReconstructionJob): Promise<ReconOutput[]> {
    const outputDir = path.join(this.jobDir(job), "output");
    const found: ReconOutput[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const format = MESH_EXTENSIONS[path.extname(entry.name).toLowerCase()];
        if (!format) continue;
        const stat = await fs.stat(full);
        found.push({ format, path: full, bytes: stat.size });
      }
    };
    await walk(outputDir);
    return found;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
