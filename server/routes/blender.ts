/**
 * HTTP routes for Blender headless operations, mounted at `/api/blender`.
 *
 *   GET  /api/blender/health          → check if Blender is available
 *   POST /api/blender/upload           → upload STL/OBJ/GLB, return server-local path
 *   POST /api/blender/import          → import a mesh file (STL/OBJ/GLB)
 *   POST /api/blender/mesh            → create a primitive mesh
 *   POST /api/blender/render          → render scene to image
 *   POST /api/blender/verify          → multi-angle visual verification
 *   GET  /api/blender/scene           → query scene contents
 *   POST /api/blender/export          → export scene to file
 *   POST /api/blender/policy          → show current tool policy
 */
import express, { Router, type Request, type Response } from 'express';
import { join } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { BlenderAdapter } from '../blenderAdapter';
import { renderMultiView, STANDARD_8_VIEWS } from '../visualVerifier';
import { verifyPart, type VisionModelConfig } from '../visionVerifier';
import { formatPolicySummary, getToolAction, BLENDER_TOOL_POLICY } from '../blenderToolPolicy';

const TMP_DIR = process.env.BLENDER_TMP_DIR || '/tmp/blender-adapter';

/** Lazy singleton — only created when first request arrives. */
let adapter: BlenderAdapter | null = null;

async function getAdapter(): Promise<BlenderAdapter> {
  if (!adapter) {
    adapter = new BlenderAdapter();
    await adapter.init();
  }
  return adapter;
}

function sendError(res: Response, status: number, code: string, detail: string): void {
  res.status(status).json({ ok: false, error: { code, detail } });
}

export function createBlenderRouter(): Router {
  const router = Router();
  // JSON body parser for POST endpoints (except /upload which uses raw)
  router.use((req, res, next) => {
    if (req.method === 'POST' && req.path !== '/upload') {
      express.json({ limit: '50mb' })(req, res, next);
    } else {
      next();
    }
  });

  // ── Health ──
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const a = await getAdapter();
      res.json({ ok: true, engine: a.name, version: a.version });
    } catch (err) {
      res.json({ ok: false, error: String(err) });
    }
  });

  // ── Upload STL/OBJ/GLB → server-local path ──
  router.post('/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req: Request, res: Response) => {
    const fileName = (req.query.fileName as string) || 'upload.stl';
    if (!req.body || req.body.length === 0) {
      sendError(res, 400, 'missing-body', 'Request body must contain mesh file bytes');
      return;
    }
    try {
      const dir = await mkdtemp(join(os.tmpdir(), 'blender-upload-'));
      const filePath = join(dir, fileName);
      await writeFile(filePath, req.body);
      res.json({ ok: true, filePath });
    } catch (err) {
      sendError(res, 500, 'upload-failed', String(err));
    }
  });

  // ── Import mesh ──
  router.post('/import', async (req: Request, res: Response) => {
    const { filePath, force } = (req.body ?? {}) as { filePath?: string; force?: boolean };
    if (!filePath) {
      sendError(res, 400, 'missing-filePath', 'filePath is required');
      return;
    }
    if (!force) {
      const action = getToolAction('import_file', BLENDER_TOOL_POLICY);
      if (action === 'confirm') {
        sendError(res, 428, 'confirmation-required', 'import_file requires confirmation. Pass force=true to proceed.');
        return;
      }
    }
    try {
      const a = await getAdapter();
      const info = await a.importMesh(filePath);
      res.json({ ok: true, result: info });
    } catch (err) {
      sendError(res, 500, 'import-failed', String(err));
    }
  });

  // ── Create primitive mesh ──
  router.post('/mesh', async (req: Request, res: Response) => {
    const { primitive, size, location } = (req.body ?? {}) as {
      primitive?: 'cube' | 'sphere' | 'cylinder' | 'plane';
      size?: number;
      location?: { x: number; y: number; z: number };
    };
    if (!primitive) {
      sendError(res, 400, 'missing-primitive', 'primitive is required (cube|sphere|cylinder|plane)');
      return;
    }
    try {
      const a = await getAdapter();
      const info = await a.createMesh(primitive, { size, location });
      res.json({ ok: true, result: info });
    } catch (err) {
      sendError(res, 500, 'mesh-failed', String(err));
    }
  });

  // ── Render scene ──
  router.post('/render', async (req: Request, res: Response) => {
    const { width, height, engine, camera, outputFormat } = (req.body ?? {}) as {
      width?: number;
      height?: number;
      engine?: 'eevee' | 'cycles';
      camera?: { position: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } };
      outputFormat?: 'png' | 'jpg';
    };
    try {
      const a = await getAdapter();
      const result = await a.render({
        width: width ?? 800,
        height: height ?? 600,
        engine: engine ?? 'eevee',
        camera,
        outputFormat: outputFormat ?? 'png',
      });
      res.json({ ok: true, result });
    } catch (err) {
      sendError(res, 500, 'render-failed', String(err));
    }
  });

  // ── Multi-angle visual verification ──
  router.post('/verify', async (req: Request, res: Response) => {
    const { filePath, provider, model, width, height } = (req.body ?? {}) as {
      filePath?: string;
      provider?: 'openai' | 'glm' | 'mock';
      model?: string;
      width?: number;
      height?: number;
    };
    if (!filePath) {
      sendError(res, 400, 'missing-filePath', 'filePath is required');
      return;
    }
    try {
      const a = await getAdapter();
      const visionConfig: VisionModelConfig = {
        provider: provider ?? 'mock',
        model,
      };
      const report = await verifyPart(a, filePath, visionConfig);
      res.json({ ok: true, result: report });
    } catch (err) {
      sendError(res, 500, 'verify-failed', String(err));
    }
  });

  // ── Query scene ──
  router.get('/scene', async (_req: Request, res: Response) => {
    try {
      const a = await getAdapter();
      const info = await a.queryScene();
      res.json({ ok: true, result: info });
    } catch (err) {
      sendError(res, 500, 'scene-query-failed', String(err));
    }
  });

  // ── Export scene ──
  router.post('/export', async (req: Request, res: Response) => {
    const { format } = (req.body ?? {}) as { format?: 'stl' | 'obj' | 'glb' };
    const fmt = format ?? 'stl';
    try {
      const a = await getAdapter();
      const outPath = join(TMP_DIR, `export_${randomBytes(4).toString('hex')}.${fmt}`);
      const result = await a.export(outPath, fmt);
      res.json({ ok: true, result });
    } catch (err) {
      sendError(res, 500, 'export-failed', String(err));
    }
  });

  // ── Tool policy info ──
  router.get('/policy', (_req: Request, res: Response) => {
    res.json({ ok: true, summary: formatPolicySummary() });
  });

  return router;
}
