import { Router, json as expressJson } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SANDBOX_ENV } from './cadSandbox';
import { resolvePython } from './cadBridge';

const MESH_SCRIPT = path.join(import.meta.dirname, 'mesh_process.py');
const MESH_PROCESS_TIMEOUT_MS = 30_000;

/**
 * Mesh processing runs trimesh + pymeshfix which are incompatible with the
 * build123d venv's numpy 2.x (pymeshfix ABI, trimesh fill_holes). Prefer the
 * dedicated .cad-bridge/mesh-venv (numpy 1.x) when present, so the two
 * dependency sets stay isolated.
 */
function resolveMeshPython(): string {
  const candidates = [
    process.env.CAD_MESH_PYTHON,
    path.join(process.cwd(), '.cad-bridge', 'mesh-venv', 'bin', 'python'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return resolvePython();
}

interface MeshProcessDiagnostics {
  triangleCount?: number;
  watertight?: boolean;
  volumeMm3?: number | null;
  surfaceAreaMm2?: number;
  bodyCount?: number | null;
  repaired?: boolean;
  repairNote?: string;
}

function runMeshProcess(
  python: string,
  cwd: string,
  inPath: string,
  outPath: string,
  decimateTo: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise) => {
    const child = spawn(python, ['-I', MESH_SCRIPT, inPath, outPath, String(decimateTo)], {
      cwd,
      env: SANDBOX_ENV,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), MESH_PROCESS_TIMEOUT_MS);
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code });
    });
  });
}

/**
 * POST /api/mesh/process — repair (best-effort) + decimate + diagnose an STL.
 * Runs trimesh in a sandboxed interpreter. Repair may be unavailable under
 * the venv's numpy 2.x; diagnostics and decimation are reliable, and failures
 * degrade gracefully instead of erroring.
 */
export function createMeshProcessRouter(): Router {
  const router = Router();
  router.use(expressJson({ limit: '50mb' }));

  router.post('/', async (req, res) => {
    const body = (req.body ?? {}) as { stlBase64?: string; decimateTo?: number };
    const stlBase64 = body.stlBase64;
    const decimateTo =
      typeof body.decimateTo === 'number'
        ? Math.max(0, Math.min(2_000_000, Math.floor(body.decimateTo)))
        : 0;

    if (typeof stlBase64 !== 'string' || stlBase64.length === 0) {
      res.status(400).json({ ok: false, error: { code: 'invalid-artifact', detail: 'missing stlBase64' } });
      return;
    }
    const input = Buffer.from(stlBase64, 'base64');
    if (input.byteLength <= 84) {
      res.status(400).json({ ok: false, error: { code: 'invalid-artifact', detail: 'STL too small' } });
      return;
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-process-'));
    const inPath = path.join(dir, 'in.stl');
    const outPath = path.join(dir, 'out.stl');
    await writeFile(inPath, input);

    try {
      const { stdout, stderr, code } = await runMeshProcess(
        resolveMeshPython(),
        dir,
        inPath,
        outPath,
        decimateTo,
      );
      if (code !== 0) {
        res.status(500).json({
          ok: false,
          error: { code: 'generation-failed', detail: `mesh process exited ${code}: ${stderr.slice(-1000)}` },
        });
        return;
      }
      let diagnostics: MeshProcessDiagnostics = {};
      try {
        diagnostics = JSON.parse(stdout) as MeshProcessDiagnostics;
      } catch {
        /* keep empty diagnostics */
      }
      const out = await readFile(outPath);
      res.json({ ok: true, processedStlBase64: out.toString('base64'), diagnostics });
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return router;
}
