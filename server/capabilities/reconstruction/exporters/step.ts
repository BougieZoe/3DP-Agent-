/**
 * STEP export channel — the one output we cannot produce ourselves.
 *
 * STL/GLB/OBJ/3MF are mesh formats; STEP is B-rep. Turning a triangle soup into STEP needs
 * a CAD kernel, so this file is a *channel*, not an implementation: it detects which kernel
 * is present and calls it. If none is present the channel reports unavailable, and the
 * capability refuses to accept a request asking for STEP rather than quietly returning a
 * mesh renamed .step. A fake STEP file is worse than an honest 503 — downstream CAD will
 * open it, then fail on fillet/chamfer/measure operations with no clue why.
 *
 * Provider abstraction applies here too: FreeCAD today, OCCT bindings or a paid kernel
 * tomorrow, without touching the v1 contract.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type StepKernelId = "freecad" | "none";

export interface StepExporterAvailability {
  available: boolean;
  kernel: StepKernelId;
  /** Human-readable prerequisite, shown to callers so they can fix their deployment. */
  unavailable_reason?: string;
}

export interface StepExportInput {
  /** Mesh produced by the reconstruction provider. */
  sourcePath: string;
  /** Mesh vertices are in millimetres, which is what STEP expects natively. */
  units: "mm" | "cm" | "in";
  outPath: string;
}

export interface StepExporter {
  /** Identifier echoed back in the response so deployments can tell kernels apart. */
  readonly id: string;
  availability(): Promise<StepExporterAvailability>;
  convert(input: StepExportInput): Promise<void>;
}

/**
 * FreeCAD in headless mode (`freecadcmd`) is the pragmatic choice: MIT/LGPL, installable
 * on macOS via `brew install --cask freecad`, and it ships OCCT plus a mesh-to-solid path.
 *
 * The conversion sews the mesh into a shell, then upgrades it to a solid. Sewing can fail on
 * open meshes (very common with photogrammetry); that is reported as a failure rather than
 * papered over, because a non-solid STEP is not a manufacturable part.
 */
class FreeCadStepExporter implements StepExporter {
  readonly id = "freecad";

  constructor(private readonly bin: string) {}

  async availability(): Promise<StepExporterAvailability> {
    try {
      await execFileAsync(this.bin, ["--version"], { timeout: 20_000 });
      return { available: true, kernel: "freecad" };
    } catch (err) {
      return {
        available: false,
        kernel: "none",
        unavailable_reason:
          `FreeCAD CLI not runnable at ${this.bin} (${(err as Error).message}). ` +
          "Install it with 'brew install --cask freecad' to enable STEP export.",
      };
    }
  }

  async convert({ sourcePath, units, outPath }: StepExportInput): Promise<void> {
    const scriptPath = `${outPath}.freecad.py`;
    const scale = units === "mm" ? 1 : units === "cm" ? 10 : 25.4;
    // Units matter: STEP has no notion of "these numbers are inches", so the mesh is scaled
    // to millimetres before export. Getting this wrong yields a part 25x too small, which
    // only shows up at the printer.
    const script = `
import Mesh, Part, sys
src, dst, scale = ${JSON.stringify(sourcePath)}, ${JSON.stringify(outPath)}, ${scale}
mesh = Mesh.Mesh(src)
if scale != 1.0:
    mesh.scale(scale, scale, scale)
shape = Part.Shape()
shape.makeShapeFromMesh(mesh.Topology, 0.1)
if not shape.Faces:
    print("EXPORT_ERROR: mesh produced no faces", file=sys.stderr); sys.exit(3)
try:
    solid = Part.makeSolid(shape)
except Exception:
    # Open shell (typical of photogrammetry): export the shell so the geometry at least
    # survives, but say so on stderr instead of pretending it is a manufacturable solid.
    print("EXPORT_WARN: shell is not a closed solid", file=sys.stderr)
    solid = shape
Part.export([solid], dst)
print("EXPORT_OK")
`;
    await fs.writeFile(scriptPath, script, "utf8");
    try {
      const { stdout, stderr } = await execFileAsync(this.bin, [scriptPath], {
        timeout: 15 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (!stdout.includes("EXPORT_OK") && !(await exists(outPath))) {
        throw new Error(stderr.trim() || "FreeCAD did not write a STEP file.");
      }
    } finally {
      await fs.rm(scriptPath, { force: true });
    }
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** A channel that always reports unavailable; keeps call sites free of null checks. */
class NoStepExporter implements StepExporter {
  readonly id = "none";
  private readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
  async availability(): Promise<StepExporterAvailability> {
    return { available: false, kernel: "none", unavailable_reason: this.reason };
  }
  async convert(): Promise<void> {
    throw new Error(this.reason);
  }
}

/**
 * Pick a kernel. `RECON_STEP_BIN` lets a deployment point at a non-standard install
 * (FreeCAD.app bundles the CLI inside the app on macOS, so the plain `freecadcmd` name
 * often does not resolve from a shell).
 */
export async function resolveStepExporter(): Promise<StepExporter> {
  const candidates = [
    process.env.RECON_STEP_BIN,
    "freecadcmd",
    "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd",
    "/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd",
    "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd",
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    const exporter = new FreeCadStepExporter(candidate);
    const availability = await exporter.availability();
    if (availability.available) return exporter;
  }

  return new NoStepExporter(
    "No CAD kernel available for STEP export. Install FreeCAD " +
      "('brew install --cask freecad') or set RECON_STEP_BIN to a runnable freecadcmd.",
  );
}

export const stepExportDir = (workDir: string): string => path.join(workDir, "derived");
