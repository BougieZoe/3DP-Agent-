/**
 * HTTP route for STEP file processing, mounted at `/api/step`.
 *
 *   GET  /api/step/health  → check if STEP parsing is available
 *   POST /api/step         → parse STEP file and return geometry + metadata
 */
import express, { Router, type Request, type Response } from 'express';
import { parseStepFile, isValidStepFile, extractStepHeaderInfo } from './stepParser';

interface StepBody {
  /** Binary STEP file, base64-encoded. */
  stepBase64?: string;
  fileName?: string;
  /** Linear deflection for tessellation (default: 0.1mm) */
  linearDeflection?: number;
  /** Angular deflection for tessellation in radians (default: 0.5) */
  angularDeflection?: number;
}

function sendError(res: Response, status: number, code: string, detail: string): void {
  res.status(status).json({ ok: false, error: { code, detail } });
}

export function createStepRouter(): Router {
  const router = Router();
  // STEP base64 bodies can be large.
  router.use(express.json({ limit: '50mb' }));

  router.get('/health', async (_req: Request, res: Response) => {
    try {
      // Test if occt-wasm is available
      const { OcctKernel } = await import('occt-wasm');
      using kernel = await OcctKernel.init();
      res.json({ ok: true, available: true });
    } catch (err) {
      res.json({ ok: true, available: false, error: String(err) });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as StepBody;

    if (typeof body.stepBase64 !== 'string' || body.stepBase64.length === 0) {
      sendError(res, 400, 'invalid-input', 'stepBase64 must be a non-empty base64 string');
      return;
    }

    try {
      const stepBytes = Buffer.from(body.stepBase64, 'base64');

      if (stepBytes.byteLength < 100) {
        sendError(res, 400, 'invalid-step', 'STEP payload too small to be a valid STEP file');
        return;
      }

      if (!isValidStepFile(stepBytes)) {
        sendError(res, 400, 'invalid-step', 'File does not appear to be a valid STEP file');
        return;
      }

      const headerInfo = extractStepHeaderInfo(stepBytes);

      const result = await parseStepFile(stepBytes, {
        linearDeflection: body.linearDeflection,
        angularDeflection: body.angularDeflection,
      });

      res.json({
        ok: true,
        result: {
          ...result,
          header: headerInfo,
          fileName: body.fileName ?? 'unknown.step',
        },
      });
    } catch (err) {
      console.error('[stepRouter] parse failed:', err);
      sendError(res, 500, 'parse-failed', String(err));
    }
  });

  return router;
}
