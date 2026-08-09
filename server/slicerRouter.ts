/**
 * HTTP route for the slicer bridge, mounted at `/api/slice`.
 *
 *   GET  /api/slice/health  → which slicer CLIs are discoverable on this host
 *   POST /api/slice         → slice an STL (base64) into G-code + metadata
 *
 * CLI auto-discovery: when a request does not pin an explicit `binary`, the
 * route probes PATH-resolvable binary names and common install paths for the
 * requested slicer (PrusaSlicer / BambuStudio).
 */
import express, { Router, type Request, type Response } from 'express';
import {
  createSlicerAdapter,
  type SlicerId,
  type SlicerProfile,
} from './slicerBridge';

const SLICER_BINARY_CANDIDATES: Record<SlicerId, string[]> = {
  prusaslicer: ['prusa-slicer', 'prusaslicer'],
  bambustudio: ['bambu-studio', 'bambustudio', 'BambuStudio'],
  custom: [],
};

const SLICER_APP_PATHS: Record<SlicerId, string[]> = {
  prusaslicer: ['/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'],
  bambustudio: [
    '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio',
    '/Applications/BambuStudio.app/Contents/MacOS/bambu-studio',
  ],
  custom: [],
};

/**
 * Probe candidate binaries (PATH names first, then app install paths) and
 * return the first that answers `--help` successfully, or null.
 */
export async function discoverSlicer(id: SlicerId): Promise<string | null> {
  const candidates = [
    ...(SLICER_BINARY_CANDIDATES[id] ?? []),
    ...(SLICER_APP_PATHS[id] ?? []),
  ];
  for (const binary of candidates) {
    const adapter = createSlicerAdapter({ id, binary });
    if (await adapter.isAvailable()) return binary;
  }
  return null;
}

interface SliceBody {
  /** Binary STL, base64-encoded. */
  stlBase64?: string;
  fileName?: string;
  slicer?: SlicerId;
  /** Explicit CLI binary; when omitted, the route auto-discovers. */
  binary?: string;
  printerPreset?: string;
  materialPreset?: string;
  layerHeightMm?: number;
  autoDropToBed?: boolean;
  timeoutMs?: number;
  extraArgs?: string[];
}

function sendError(res: Response, status: number, code: string, detail: string): void {
  res.status(status).json({ ok: false, error: { code, detail } });
}

export function createSlicerRouter(): Router {
  const router = Router();
  // STL base64 bodies can be tens of MB.
  router.use(express.json({ limit: '30mb' }));

  router.get('/health', async (_req: Request, res: Response) => {
    const [prusaslicer, bambustudio] = await Promise.all([
      discoverSlicer('prusaslicer'),
      discoverSlicer('bambustudio'),
    ]);
    res.json({ ok: true, slicers: { prusaslicer, bambustudio } });
  });

  router.post('/', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as SliceBody;

    if (typeof body.stlBase64 !== 'string' || body.stlBase64.length === 0) {
      sendError(res, 400, 'invalid-input', 'stlBase64 must be a non-empty base64 string');
      return;
    }

    const id: SlicerId = body.slicer ?? 'prusaslicer';

    let binary = typeof body.binary === 'string' && body.binary.length > 0 ? body.binary : null;
    if (!binary) binary = await discoverSlicer(id);
    if (!binary) {
      sendError(
        res,
        404,
        'slicer-not-found',
        `No ${id} CLI found on this machine. Pass an explicit "binary" path.`,
      );
      return;
    }

    const profile: SlicerProfile = {
      id,
      binary,
      printerPreset: body.printerPreset,
      materialPreset: body.materialPreset,
      layerHeightMm: typeof body.layerHeightMm === 'number' ? body.layerHeightMm : undefined,
      extraArgs: Array.isArray(body.extraArgs) ? body.extraArgs : undefined,
    };

    const adapter = createSlicerAdapter(profile);

    try {
      const stlBytes = Buffer.from(body.stlBase64, 'base64');
      const result = await adapter.slice({
        stlBytes,
        fileName: body.fileName,
        profile,
        autoDropToBed: body.autoDropToBed === true,
        timeoutMs: body.timeoutMs,
      });
      res.json({ ok: true, result });
    } catch (err) {
      console.error('[slicerRouter] slice failed:', err);
      sendError(res, 500, 'slice-failed', String(err));
    }
  });

  return router;
}
