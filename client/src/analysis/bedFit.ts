import {
  moduleResult,
  PRINTER_PROFILES,
  type AnalysisModuleResult,
  type Confidence,
  type BedFitResult,
  type PrinterBedProfile,
  type PrinterProfileId,
} from './types';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

const ROTATIONS = [
  { x: 0, y: 0, z: 0, label: 'original' },
  { x: Math.PI / 2, y: 0, z: 0, label: 'rotateX_90' },
  { x: 0, y: 0, z: Math.PI / 2, label: 'rotateZ_90' },
  { x: Math.PI / 2, y: 0, z: Math.PI / 2, label: 'rotateXZ_90' },
  { x: 0, y: 0, z: -Math.PI / 2, label: 'rotateZ_neg90' },
  { x: -Math.PI / 2, y: 0, z: 0, label: 'rotateX_neg90' },
];

export function getPrinterProfile(id: PrinterProfileId = 'bambu_x1c'): PrinterBedProfile {
  return { ...PRINTER_PROFILES[id] };
}

export function checkBedFit(
  model: GeometryModel,
  printerId: PrinterProfileId = 'bambu_x1c',
  graph?: GeometryGraph | null,
): AnalysisModuleResult<BedFitResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g) {
    return moduleResult('bedFit', 0.0, 0, emptyBedFitResult(printerId), 'No position data');
  }

  const origSize = { x: g.boundingBoxDimensions.x, y: g.boundingBoxDimensions.y, z: g.boundingBoxDimensions.z };
  const profile = getPrinterProfile(printerId);

  const orientations: Array<{ rotation: { x: number; y: number; z: number }; score: number; reason: string }> = [];

  for (const rot of ROTATIONS) {
    const rotatedSize = rotateBoundingBox(origSize, rot);

    const fitsX = rotatedSize.x <= profile.widthMm;
    const fitsY = rotatedSize.z <= profile.heightMm;
    const fitsZ = rotatedSize.z <= profile.depthMm;

    let score = 0;
    const clearX = profile.widthMm - rotatedSize.x;
    const clearY = profile.depthMm - rotatedSize.y;
    const clearZ = profile.heightMm - rotatedSize.z;

    if (fitsX && fitsY && fitsZ) {
      const footprint = (rotatedSize.x / profile.widthMm) * (rotatedSize.y / profile.depthMm);
      const heightRatio = rotatedSize.z / profile.heightMm;
      score = Math.round(100 * (1 - 0.3 * footprint - 0.7 * heightRatio));
      score = Math.max(10, score);
    } else {
      score = 0;
    }

    orientations.push({
      rotation: { x: rot.x, y: rot.y, z: rot.z },
      score,
      reason: fitsX && fitsY && fitsZ
        ? `Fits with ${clearX.toFixed(0)}mm X, ${clearY.toFixed(0)}mm Y, ${clearZ.toFixed(0)}mm Z clearance`
        : `Does not fit (${rotatedSize.x.toFixed(0)}×${rotatedSize.y.toFixed(0)}×${rotatedSize.z.toFixed(0)})`,
    });
  }

  orientations.sort((a, b) => b.score - a.score);
  const best = orientations[0];
  const fits = best.score > 0;

  const bestRotated = rotateBoundingBox(origSize, { x: best.rotation.x, y: best.rotation.y, z: best.rotation.z, label: '' });

  const result: BedFitResult = {
    fits,
    printerProfile: profile,
    modelDimensionsMm: { x: bestRotated.x, y: bestRotated.y, z: bestRotated.z },
    clearanceMm: {
      x: Math.max(0, profile.widthMm - bestRotated.x),
      y: Math.max(0, profile.depthMm - bestRotated.y),
      z: Math.max(0, profile.heightMm - bestRotated.z),
    },
    bestOrientation: { x: best.rotation.x, y: best.rotation.y, z: best.rotation.z },
    orientations: orientations.slice(0, 3),
  };

  const confidence: Confidence = 1.0;

  const explanation = fits
    ? `Model fits on ${profile.name} (${profile.widthMm}×${profile.depthMm}×${profile.heightMm}mm). Best orientation: ${best.reason}`
    : `Model does NOT fit on ${profile.name} in any orientation. Largest dimension: ${Math.max(origSize.x, origSize.y, origSize.z).toFixed(0)}mm`;

  return moduleResult('bedFit', confidence, Math.round(performance.now() - startTime), result, explanation);
}

function rotateBoundingBox(
  size: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; label: string },
): { x: number; y: number; z: number } {
  const dims = [size.x, size.y, size.z];
  const rx = Math.round(rotation.x / (Math.PI / 2)) % 4;
  const rz = Math.round(rotation.z / (Math.PI / 2)) % 4;

  let [x, y, z] = dims;

  if (rx === 1 || rx === -3) { const t = y; y = z; z = t; }
  else if (rx === 2 || rx === -2) { y = -y; z = -z; }
  else if (rx === 3 || rx === -1) { const t = y; y = z; z = t; y = -y; z = -z; }

  if (rz === 1 || rz === -3) { const t = x; x = y; y = t; }
  else if (rz === 2 || rz === -2) { x = -x; y = -y; }
  else if (rz === 3 || rz === -1) { const t = x; x = y; y = t; x = -x; y = -y; }

  return { x: Math.abs(x), y: Math.abs(y), z: Math.abs(z) };
}

function emptyBedFitResult(printerId: PrinterProfileId): BedFitResult {
  const profile = getPrinterProfile(printerId);
  return {
    fits: false,
    printerProfile: profile,
    modelDimensionsMm: { x: 0, y: 0, z: 0 },
    clearanceMm: { x: 0, y: 0, z: 0 },
    bestOrientation: { x: 0, y: 0, z: 0 },
    orientations: [],
  };
}
