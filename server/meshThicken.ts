import { Router, json as expressJson } from 'express';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SANDBOX_ENV, SANDBOX_FILE_KB, SANDBOX_MEM_KB, SANDBOX_CPU_S } from './cadSandbox';
import { resolveMeshPython } from './meshProcess';
import { currentDir } from './currentDir';

const THICKEN_SCRIPT = path.join(currentDir, 'mesh_thicken.py');
/**
 * Longer than mesh/process: a true offset is a Minkowski sum, measured at
 * ~0.29 ms per input triangle (80k triangles ≈ 25 s at delta 0.15). The
 * worker's own budget refusal keeps most oversized inputs out before this.
 */
const THICKEN_TIMEOUT_MS = 90_000;
const MAX_TRIANGLES = 80_000;
const MIN_DELTA_MM = 0.02;
const MAX_DELTA_MM = 2.0;
const DEFAULT_SEGMENTS = 8;

export interface ThickenDiagnostics {
  status?: 'ok' | 'not_closed' | 'too_large' | 'empty_result' | 'error';
  deltaMm?: number | null;
  segments?: number;
  inputTriangles?: number | null;
  outputTriangles?: number | null;
  watertightBefore?: boolean | null;
  watertightAfter?: boolean | null;
  volumeBeforeMm3?: number | null;
  volumeAfterMm3?: number | null;
  minWallBeforeMm?: number | null;
  minWallAfterMm?: number | null;
  growthMm?: number | null;
  elapsedMs?: number | null;
  error?: string;
}

function binaryStlTriangleCount(buf: Buffer): number {
  if (buf.byteLength < 84) return 0;
  return buf.readUInt32LE(80);
}

function runThicken(
  python: string,
  cwd: string,
  inPath: string,
  outPath: string,
  deltaMm: number,
  diagPath: string,
  segments: number,
): Promise<{ stderr: string; code: number | null }> {
  return new Promise((resolvePromise) => {
    // Same sandbox posture as the other bridges: isolated interpreter (-I),
    // sanitized env, resource ceilings before exec.
    const ulimitCmd =
      `ulimit -v ${SANDBOX_MEM_KB} 2>/dev/null; ` +
      `ulimit -t ${SANDBOX_CPU_S} 2>/dev/null; ` +
      `ulimit -f ${SANDBOX_FILE_KB} 2>/dev/null; ` +
      `exec "$0" "$@"`;
    const child = spawn(
      '/bin/sh',
      ['-c', ulimitCmd, python, '-I', THICKEN_SCRIPT, inPath, outPath, String(deltaMm), diagPath, String(segments)],
      { cwd, env: SANDBOX_ENV },
    );
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), THICKEN_TIMEOUT_MS);
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolvePromise({ stderr, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ stderr, code });
    });
  });
}

/**
 * POST /api/mesh/thicken — true solid offset (Minkowski sum with a ball).
 *
 * A bridge "ok" is not acceptance: the client re-analyses the returned mesh
 * and keeps the change only if the measured wall improved. This route reports
 * what it did, not whether it is good (see docs/bridge-thicken.md).
 *
 * Status mapping deliberately mirrors the worker's exit codes so a caller can
 * act on the HTTP status without parsing prose:
 *   0 -> 200 ok, 2 -> 422 not_closed, 3 -> 413 too_large, else 500.
 */
export function createMeshThickenRouter(): Router {
  const router = Router();
  router.use(expressJson({ limit: '50mb' }));

  router.post('/', async (req, res) => {
    const body = (req.body ?? {}) as { stlBase64?: string; deltaMm?: number; segments?: number };
    const stlBase64 = body.stlBase64;
    const deltaMm = typeof body.deltaMm === 'number' ? body.deltaMm : Number.NaN;
    const segments =
      typeof body.segments === 'number'
        ? Math.max(6, Math.min(32, Math.floor(body.segments)))
        : DEFAULT_SEGMENTS;

    if (typeof stlBase64 !== 'string' || stlBase64.length === 0) {
      res.status(400).json({ ok: false, error: { code: 'invalid-artifact', detail: 'missing stlBase64' } });
      return;
    }
    if (!Number.isFinite(deltaMm) || deltaMm < MIN_DELTA_MM || deltaMm > MAX_DELTA_MM) {
      res.status(400).json({
        ok: false,
        error: { code: 'invalid-delta', detail: `deltaMm must be within [${MIN_DELTA_MM}, ${MAX_DELTA_MM}]` },
      });
      return;
    }

    const input = Buffer.from(stlBase64, 'base64');
    if (input.byteLength <= 84) {
      res.status(400).json({ ok: false, error: { code: 'invalid-artifact', detail: 'STL too small' } });
      return;
    }
    const triCount = binaryStlTriangleCount(input);
    if (triCount > MAX_TRIANGLES) {
      res.status(413).json({
        ok: false,
        status: 'too_large',
        error: {
          code: 'too-large',
          detail: `STL has ${triCount.toLocaleString()} triangles (max ${MAX_TRIANGLES.toLocaleString()}); a true offset is ~0.29ms per triangle`,
        },
      });
      return;
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-thicken-'));
    const inPath = path.join(dir, 'in.stl');
    const outPath = path.join(dir, 'out.stl');
    const diagPath = path.join(dir, 'diag.json');
    await writeFile(inPath, input);

    try {
      const { stderr, code } = await runThicken(
        resolveMeshPython(),
        dir,
        inPath,
        outPath,
        deltaMm,
        diagPath,
        segments,
      );

      let diagnostics: ThickenDiagnostics = {};
      try {
        diagnostics = JSON.parse(await readFile(diagPath, 'utf-8')) as ThickenDiagnostics;
      } catch {
        /* keep empty diagnostics */
      }

      if (code === 2 || diagnostics.status === 'not_closed') {
        // 422, not 500: the request was well-formed, the mesh is not a solid.
        res.status(422).json({ ok: false, status: 'not_closed', diagnostics });
        return;
      }
      if (code === 3 || diagnostics.status === 'too_large') {
        res.status(413).json({ ok: false, status: 'too_large', diagnostics });
        return;
      }
      if (code !== 0 || diagnostics.status !== 'ok') {
        res.status(500).json({
          ok: false,
          status: 'error',
          error: {
            code: 'thicken-failed',
            detail: (diagnostics.error || stderr.slice(-500) || `worker exited ${code}`).trim(),
          },
          diagnostics,
        });
        return;
      }

      const out = await readFile(outPath);
      res.json({ ok: true, status: 'ok', thickenedStlBase64: out.toString('base64'), diagnostics });
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return router;
}
