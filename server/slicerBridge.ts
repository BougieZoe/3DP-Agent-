/**
 * Slicer CLI Bridge — a standardized interface for driving local slicer CLIs
 * (PrusaSlicer, BambuStudio, …) from the backend to produce real G-code and
 * exact print-time / filament / layer metadata.
 *
 * This is a SKELETON: it defines the request/result contract, a pure G-code
 * metadata + layer parser, a binary-STL bed-drop helper, and a
 * `createSlicerAdapter` factory that shells out via `child_process.execFile`.
 * It is not yet mounted on the HTTP server — that is a follow-up.
 *
 * Typical flow:
 *   STL bytes (bed-normalized, e.g. via client `dropToBed`, or the bridge's own
 *   `autoDropToBed`) → adapter.slice() → G-code + parsed metadata.
 *
 * Dependency injection (`SlicerAdapterDeps`) keeps the CLI invocation testable
 * without a slicer installed: tests inject a fake `execFile`.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type SlicerId = 'prusaslicer' | 'bambustudio' | 'custom';

export interface SlicerProfile {
  id: SlicerId;
  /** CLI binary: an absolute path or a name resolved on PATH. */
  binary: string;
  /** Slicer printer preset, e.g. 'MK3S' or 'Bambu Lab X1C'. */
  printerPreset?: string;
  /** Slicer filament preset. */
  materialPreset?: string;
  layerHeightMm?: number;
  /** Slicer-specific extra flags (print/quality profiles, etc.). */
  extraArgs?: string[];
}

export interface SlicerRequest {
  /** Binary STL bytes. Prefer bed-normalized input (see `autoDropToBed`). */
  stlBytes: ArrayBuffer | Uint8Array;
  fileName?: string;
  profile: SlicerProfile;
  /** When true, the bridge translates the mesh so minZ = 0 before slicing. */
  autoDropToBed?: boolean;
  timeoutMs?: number;
}

export interface SlicerLayerInfo {
  /** 0-based layer index from the `;LAYER:n` marker. */
  layerNumber: number;
  zMm: number;
  heightMm: number;
  /** Best-effort per-layer print time (seconds) when the slicer emits it. */
  timeSeconds?: number;
}

export interface SlicerMetadata {
  /** Exact print time parsed from the slicer's G-code header. */
  printTimeMinutes: number;
  /** Filament used in grams. */
  filamentGrams: number;
  layerCount: number;
  layerHeightMm: number | null;
}

export interface SlicerResult {
  gcode: string;
  fileName: string;
  metadata: SlicerMetadata;
  layers: SlicerLayerInfo[];
  warnings: string[];
}

export interface SlicerAdapter {
  id: SlicerId;
  /** Probe the CLI (e.g. `--help`) to confirm the slicer is installed. */
  isAvailable(): Promise<boolean>;
  slice(request: SlicerRequest): Promise<SlicerResult>;
}

/** Injectable node APIs — tests override `execFile` to avoid real subprocesses. */
export interface SlicerAdapterDeps {
  execFile?: typeof execFile;
  mkdtemp?: (prefix: string) => Promise<string>;
  readFile?: (p: string) => Promise<Buffer>;
  writeFile?: (p: string, data: Uint8Array) => Promise<void>;
  rm?: (p: string, opts: { recursive?: boolean; force?: boolean }) => Promise<void>;
  tmpdir?: () => string;
}

const DEFAULT_TIMEOUT_MS = 180_000;
/**
 * Hard ceiling for a single slice invocation. Client-supplied timeouts are
 * clamped to this value so a hostile/buggy request cannot pin a worker forever.
 */
export const MAX_TIMEOUT_MS = 300_000;

/** Security: only absolute paths may be executed — a bare name could resolve
 * via PATH to an attacker-controlled binary. */
function assertAbsoluteBinary(binary: string): void {
  if (!path.isAbsolute(binary)) {
    throw new Error(`Refusing to run non-absolute slicer binary: "${binary}"`);
  }
}

export function createSlicerAdapter(profile: SlicerProfile, deps: SlicerAdapterDeps = {}): SlicerAdapter {
  const runExec = deps.execFile ?? execFile;
  const mkdir = deps.mkdtemp ?? mkdtemp;
  const read = deps.readFile ?? readFile;
  const write = deps.writeFile ?? writeFile;
  const remove = deps.rm ?? rm;
  const tmp = deps.tmpdir ?? tmpdir;

  return {
    id: profile.id,

    async isAvailable(): Promise<boolean> {
      if (!path.isAbsolute(profile.binary)) return false;
      return new Promise((resolve) => {
        runExec(profile.binary, ['--help'], { timeout: 5_000 }, (err) => resolve(err === null));
      });
    },

    async slice(request: SlicerRequest): Promise<SlicerResult> {
      // Security: refuse anything that is not an absolute, server-whitelisted path.
      assertAbsoluteBinary(request.profile.binary);
      const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const dir = await mkdir(path.join(tmp(), 'slicer-'));
      const stlPath = path.join(dir, 'model.stl');
      const gcodePath = path.join(dir, 'model.gcode');
      const warnings: string[] = [];

      try {
        let bytes = toUint8Array(request.stlBytes);
        if (request.autoDropToBed) {
          const dropped = dropStlToBed(bytes);
          if (dropped !== bytes) warnings.push('autoDropToBed: mesh translated so minZ = 0');
          bytes = dropped;
        }
        await write(stlPath, bytes);

        const args = buildSlicerArgs(request.profile, stlPath, gcodePath);
        await runExecAsync(runExec, request.profile.binary, args, timeoutMs);

        const gcode = (await read(gcodePath)).toString('utf-8');
        return {
          gcode,
          fileName: request.fileName ?? 'model.gcode',
          metadata: parseGCodeMetadata(gcode),
          layers: parseLayers(gcode),
          warnings,
        };
      } finally {
        await remove(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

function buildSlicerArgs(profile: SlicerProfile, stlPath: string, gcodePath: string): string[] {
  const args: string[] = ['--export-gcode'];
  if (profile.printerPreset) args.push('--printer', profile.printerPreset);
  if (profile.materialPreset) args.push('--filament', profile.materialPreset);
  if (profile.layerHeightMm != null) args.push('--layer-height', String(profile.layerHeightMm));
  if (profile.extraArgs) args.push(...profile.extraArgs);
  args.push('--output', gcodePath, stlPath);
  return args;
}

function runExecAsync(
  exec: typeof execFile,
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(binary, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`Slicer ${binary} failed: ${err.message}${stderr ? `\n${stderr.slice(0, 2000)}` : ''}`));
      } else {
        resolve();
      }
    });
  });
}

function toUint8Array(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  return new Uint8Array(bytes);
}

/**
 * Translate a BINARY STL's vertices so its minZ rests on the build plate (Z = 0).
 * Binary STL layout: 80-byte header, uint32 triangle count, then per triangle
 * a 12-byte normal, 9 × float32 vertex coordinates, and a uint16 attribute
 * (50 bytes per triangle). Only the Z of each vertex is touched, so the mesh
 * is dropped straight down onto the plate.
 *
 * Returns the input unchanged when it already sits on the bed or is invalid.
 */
export function dropStlToBed(stlBytes: Uint8Array): Uint8Array {
  if (stlBytes.byteLength < 84) return stlBytes;
  const view = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength);
  const triCount = view.getUint32(80, true);

  // Strict boundary check: the claimed triangle count must match the buffer
  // size. A hostile header claiming millions of triangles over a tiny buffer
  // would otherwise index past the end (throw / DoS). Malformed input is
  // returned untouched rather than processed.
  if (!Number.isInteger(triCount) || 84 + triCount * 50 > stlBytes.byteLength) return stlBytes;

  let minZ = Infinity;
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const z = view.getFloat32(off + 20 + v * 12, true);
      if (z < minZ) minZ = z;
    }
    off += 50;
  }
  if (!Number.isFinite(minZ) || minZ === 0) return stlBytes;

  const out = new Uint8Array(stlBytes.byteLength);
  out.set(stlBytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  off = 84;
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const z = view.getFloat32(off + 20 + v * 12, true);
      outView.setFloat32(off + 20 + v * 12, z - minZ, true);
    }
    off += 50;
  }
  return out;
}

export interface GCodeMetadata extends SlicerMetadata {}

/**
 * Parse slicer print metadata from G-code header comments. Handles the
 * PrusaSlicer / BambuStudio comment dialect:
 *   ; estimated printing time (normal mode) = 0m 42s
 *   ; filament used [g] = 0.79
 *   ; layer_height = 0.2
 *   ; total layers count = 21   (older slicers: `; layer_count = 21`)
 * Missing fields fall back to safe defaults (0 / null) rather than guessing.
 */
export function parseGCodeMetadata(gcode: string): GCodeMetadata {
  const timeMatch = gcode.match(/estimated printing time[^=]*=\s*([\dhms\s]+)/);
  const filamentMatch = gcode.match(/filament used \[g\]\s*=\s*([\d.]+)/);
  const layerCountMatch = gcode.match(/(?:total layers count|layer_count)\s*=\s*(\d+)/);
  const layerHeightMatch = gcode.match(/layer_height\s*=\s*([\d.]+)/);

  return {
    printTimeMinutes: timeMatch ? parsePrintTime(timeMatch[1]) : 0,
    filamentGrams: filamentMatch ? parseFloat(filamentMatch[1]) : 0,
    layerCount: layerCountMatch ? parseInt(layerCountMatch[1], 10) : 0,
    layerHeightMm: layerHeightMatch ? parseFloat(layerHeightMatch[1]) : null,
  };
}

/** Parse a print-time string like `1h 2m 3s` / `27m 25s` / `42s` into minutes. */
function parsePrintTime(s: string): number {
  let total = 0;
  const h = s.match(/(\d+)h/);
  if (h) total += parseInt(h[1], 10) * 60;
  const m = s.match(/(\d+)m/);
  if (m) total += parseInt(m[1], 10);
  const sec = s.match(/(\d+)s/);
  if (sec) total += parseInt(sec[1], 10) / 60;
  return Math.round(total * 100) / 100;
}

/**
 * Pair `;LAYER:n` markers with the following `;Z:...` value to build a
 * layer-by-layer table. Handles the PrusaSlicer/BambuStudio order
 * (`;LAYER:n` then `;Z:...`); layer thickness is the Z delta from the
 * previous layer. Note: exact per-layer *time* is not present in standard
 * G-code — a slicer-specific verbose marker would be required, so
 * `timeSeconds` is omitted unless such a marker is added later.
 */
export function parseLayers(gcode: string): SlicerLayerInfo[] {
  const layers: SlicerLayerInfo[] = [];
  let currentLayer = -1;
  let lastZ: number | null = null;

  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    const layerMatch = /^;LAYER:(\d+)/.exec(line);
    if (layerMatch) {
      currentLayer = parseInt(layerMatch[1], 10);
      continue;
    }
    const zMatch = /^;Z:([\d.]+)/.exec(line);
    if (zMatch && currentLayer >= 0) {
      const z = parseFloat(zMatch[1]);
      const heightMm = lastZ !== null ? Math.max(0, Math.round((z - lastZ) * 1000) / 1000) : 0;
      layers.push({ layerNumber: currentLayer, zMm: z, heightMm });
      lastZ = z;
    }
  }

  return layers;
}
