/**
 * Client for /api/slice — slice an STL into G-code + metadata
 * via a local slicer CLI (PrusaSlicer / BambuStudio).
 *
 * This client is used by STLUploadHandler to fetch ground-truth print metrics
 * (time, filament, layers) that feed into the analysis pipeline, replacing
 * volume-based estimates with real slicer data.
 */

/** Supported slicer IDs — mirrors server/slicerBridge.ts SlicerId */
export type SlicerId = 'prusaslicer' | 'bambustudio' | 'custom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SliceRequest {
  /** Binary STL bytes. */
  stlBytes: ArrayBuffer;
  fileName?: string;
  slicer?: SlicerId;
  printerPreset?: string;
  materialPreset?: string;
  layerHeightMm?: number;
  autoDropToBed?: boolean;
  timeoutMs?: number;
}

export interface SliceLayerInfo {
  layerNumber: number;
  zMm: number;
  heightMm: number;
}

export interface SliceMetadata {
  /** Exact print time parsed from slicer G-code header (minutes). */
  printTimeMinutes: number;
  /** Filament used in grams. */
  filamentGrams: number;
  layerCount: number;
  layerHeightMm: number | null;
}

export interface SliceResult {
  gcode: string;
  fileName: string;
  metadata: SliceMetadata;
  layers: SliceLayerInfo[];
  warnings: string[];
}

/** Provenance info stored on UploadedModel to track data source in UI. */
export interface SliceProvenance {
  slicerId: SlicerId;
  slicedAt: string; // ISO 8601
  profileUsed: string;
  autoDropToBed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Slice an STL file via POST /api/slice.
 *
 * Returns ground-truth print metrics parsed from the slicer's G-code output.
 * On failure, throws with the server error detail.
 */
export async function sliceSTL(request: SliceRequest): Promise<SliceResult> {
  const res = await fetch("/api/slice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stlBase64: arrayBufferToBase64(request.stlBytes),
      fileName: request.fileName,
      slicer: request.slicer ?? "prusaslicer",
      printerPreset: request.printerPreset,
      materialPreset: request.materialPreset,
      layerHeightMm: request.layerHeightMm,
      autoDropToBed: request.autoDropToBed ?? true,
      timeoutMs: request.timeoutMs,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = data?.error?.detail ?? `HTTP ${res.status}`;
    throw new Error(`Slice failed: ${detail}`);
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slice failed: ${data.error?.detail ?? "unknown error"}`);
  }

  return data.result;
}

/**
 * Check which slicers are available on this machine.
 */
export async function checkSlicerHealth(): Promise<{
  prusaslicer: string | null;
  bambustudio: string | null;
}> {
  const res = await fetch("/api/slice/health");
  const data = await res.json();
  return data.slicers ?? { prusaslicer: null, bambustudio: null };
}
