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
import path from 'node:path';
import {
  createSlicerAdapter,
  type SlicerId,
  type SlicerProfile,
} from './slicerBridge';

// SECURITY: only ABSOLUTE paths may be executed. Bare binary names (resolved
// via PATH) and any client-supplied path are never run. Discovery is limited
// to (a) server-configured paths via the SLICER_PATHS env var and (b) well
// known absolute install locations.
const SLICER_APP_PATHS: Record<SlicerId, string[]> = {
  prusaslicer: ['/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'],
  orcaslicer: ['/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'],
  bambustudio: [
    '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio',
    '/Applications/BambuStudio.app/Contents/MacOS/bambu-studio',
  ],
  custom: [],
};

/** Server-configured absolute slicer paths (colon-separated). */
function serverConfiguredSlicerPaths(): string[] {
  const raw = process.env.SLICER_PATHS ?? '';
  return raw
    .split(':')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && path.isAbsolute(s));
}

/**
 * Probe the server-configured whitelist and return the first binary that
 * answers `--help` successfully, or null. When SLICER_PATHS is set it is the
 * AUTHORITATIVE whitelist (only those paths are probed); otherwise discovery
 * falls back to well-known install locations. Either way, only absolute,
 * server-configured paths are ever executed.
 */
export async function discoverSlicer(id: SlicerId): Promise<string | null> {
  const configured = serverConfiguredSlicerPaths();
  const candidates = configured.length > 0 ? configured : (SLICER_APP_PATHS[id] ?? []);
  const seen = new Set<string>();
  for (const binary of candidates) {
    if (seen.has(binary)) continue;
    seen.add(binary);
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
  printerPreset?: string;
  materialPreset?: string;
  layerHeightMm?: number;
  autoDropToBed?: boolean;
  timeoutMs?: number;
  /** Large-format printer profile override. */
  largeFormat?: boolean;
}

/**
 * Large-format printer profiles for OrcaSlicer.
 * These extend the standard Bambu Lab profiles with larger bed dimensions.
 */
const LARGE_FORMAT_PROFILES: Record<string, { widthMm: number; depthMm: number; heightMm: number }> = {
  // Bambu Lab FDM
  'bambu_h2d': { widthMm: 350, depthMm: 350, heightMm: 350 },
  'bambu_h2d_pro': { widthMm: 350, depthMm: 350, heightMm: 350 },
  'bambu_x1c': { widthMm: 256, depthMm: 256, heightMm: 256 },
  'bambu_p1s': { widthMm: 256, depthMm: 256, heightMm: 256 },
  'bambu_a1': { widthMm: 256, depthMm: 256, heightMm: 256 },
  'bambu_a1_mini': { widthMm: 180, depthMm: 180, heightMm: 180 },
};

/**
 * Industrial SLA/SLS printer profiles.
 * These are for reference and UI display - actual slicing requires vendor software.
 */
export const INDUSTRIAL_PRINTER_PROFILES: Record<string, {
  name: string;
  technology: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  layerRangeMm: { min: number; max: number };
  vendor: string;
}> = {
  // Formlabs SLA
  'formlabs.form3': {
    name: 'Form 3',
    technology: 'sla',
    widthMm: 145,
    depthMm: 145,
    heightMm: 185,
    layerRangeMm: { min: 0.025, max: 0.1 },
    vendor: 'Formlabs',
  },
  'formlabs.form3l': {
    name: 'Form 3L',
    technology: 'sla',
    widthMm: 335,
    depthMm: 200,
    heightMm: 300,
    layerRangeMm: { min: 0.025, max: 0.1 },
    vendor: 'Formlabs',
  },
  'formlabs.form4': {
    name: 'Form 4',
    technology: 'sla',
    widthMm: 200,
    depthMm: 125,
    heightMm: 210,
    layerRangeMm: { min: 0.025, max: 0.1 },
    vendor: 'Formlabs',
  },
  // EOS SLS
  'eos.p396': {
    name: 'EOS P 396',
    technology: 'sls',
    widthMm: 340,
    depthMm: 340,
    heightMm: 620,
    layerRangeMm: { min: 0.06, max: 0.12 },
    vendor: 'EOS',
  },
  'eos.p770': {
    name: 'EOS P 770',
    technology: 'sls',
    widthMm: 700,
    depthMm: 380,
    heightMm: 580,
    layerRangeMm: { min: 0.06, max: 0.12 },
    vendor: 'EOS',
  },
  'eos.m290': {
    name: 'EOS M 290',
    technology: 'slm',
    widthMm: 250,
    depthMm: 250,
    heightMm: 325,
    layerRangeMm: { min: 0.02, max: 0.08 },
    vendor: 'EOS',
  },
  // Desktop Metal
  'desktop_metal.shop_system': {
    name: 'Shop System',
    technology: 'binder_jetting',
    widthMm: 300,
    depthMm: 200,
    heightMm: 200,
    layerRangeMm: { min: 0.05, max: 0.1 },
    vendor: 'Desktop Metal',
  },
  'desktop_metal.production': {
    name: 'Production System',
    technology: 'binder_jetting',
    widthMm: 600,
    depthMm: 400,
    heightMm: 400,
    layerRangeMm: { min: 0.05, max: 0.1 },
    vendor: 'Desktop Metal',
  },
  // HP MJF
  'hp.mjf5200': {
    name: 'HP Jet Fusion 5200',
    technology: 'mjf',
    widthMm: 380,
    depthMm: 285,
    heightMm: 380,
    layerRangeMm: { min: 0.07, max: 0.1 },
    vendor: 'HP',
  },
  // Markforged
  'markforged.fx20': {
    name: 'FX20',
    technology: 'fff',
    widthMm: 525,
    depthMm: 400,
    heightMm: 400,
    layerRangeMm: { min: 0.1, max: 0.2 },
    vendor: 'Markforged',
  },
  'markforged.x7': {
    name: 'X7',
    technology: 'continuous_fiber',
    widthMm: 330,
    depthMm: 270,
    heightMm: 200,
    layerRangeMm: { min: 0.1, max: 0.2 },
    vendor: 'Markforged',
  },
  // Ultimaker
  'ultimaker.s5': {
    name: 'Ultimaker S5',
    technology: 'fff',
    widthMm: 330,
    depthMm: 240,
    heightMm: 300,
    layerRangeMm: { min: 0.02, max: 0.6 },
    vendor: 'Ultimaker',
  },
  // Raise3D
  'raise3d.pro3': {
    name: 'Pro3',
    technology: 'fff',
    widthMm: 300,
    depthMm: 300,
    heightMm: 300,
    layerRangeMm: { min: 0.01, max: 0.5 },
    vendor: 'Raise3D',
  },
};

function sendError(res: Response, status: number, code: string, detail: string): void {
  res.status(status).json({ ok: false, error: { code, detail } });
}

export function createSlicerRouter(): Router {
  const router = Router();
  // STL base64 bodies can be tens of MB.
  router.use(express.json({ limit: '30mb' }));

  router.get('/health', async (_req: Request, res: Response) => {
    const [prusaslicer, orcaslicer, bambustudio] = await Promise.all([
      discoverSlicer('prusaslicer'),
      discoverSlicer('orcaslicer'),
      discoverSlicer('bambustudio'),
    ]);
    res.json({ ok: true, slicers: { prusaslicer, orcaslicer, bambustudio } });
  });

  // List available printer profiles
  router.get('/profiles', (_req: Request, res: Response) => {
    res.json({ 
      ok: true, 
      profiles: INDUSTRIAL_PRINTER_PROFILES,
      largeFormatProfiles: LARGE_FORMAT_PROFILES,
    });
  });

  router.post('/', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as SliceBody;

    if (typeof body.stlBase64 !== 'string' || body.stlBase64.length === 0) {
      sendError(res, 400, 'invalid-input', 'stlBase64 must be a non-empty base64 string');
      return;
    }

    const id: SlicerId = body.slicer ?? 'prusaslicer';

    // SECURITY: never execute a client-supplied binary path or client-provided
    // extra flags. Only server-whitelisted, auto-discovered slicers run.
    const binary = await discoverSlicer(id);
    if (!binary) {
      sendError(
        res,
        404,
        'slicer-not-found',
        `No ${id} slicer found on this machine (checked SLICER_PATHS and well-known install paths).`,
      );
      return;
    }

    const profile: SlicerProfile = {
      id,
      binary,
      printerPreset: body.printerPreset,
      materialPreset: body.materialPreset,
      layerHeightMm: typeof body.layerHeightMm === 'number' ? body.layerHeightMm : undefined,
      // NOTE: extraArgs is intentionally never populated from request input —
      // it is reserved for server-side configuration only.
    };

    // Handle large-format printer profiles
    if (body.largeFormat && body.printerPreset) {
      const largeFormatProfile = LARGE_FORMAT_PROFILES[body.printerPreset.toLowerCase()];
      if (largeFormatProfile) {
        // Add large-format specific args
        if (!profile.extraArgs) profile.extraArgs = [];
        profile.extraArgs.push(
          '--bed-shape', `${largeFormatProfile.widthMm}x${largeFormatProfile.depthMm}`,
          '--max-print-height', String(largeFormatProfile.heightMm),
        );
      }
    }

    const adapter = createSlicerAdapter(profile);

    try {
      const stlBytes = Buffer.from(body.stlBase64, 'base64');
      if (stlBytes.byteLength < 84) {
        sendError(res, 400, 'invalid-stl', 'STL payload too small to be a valid binary STL');
        return;
      }
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
