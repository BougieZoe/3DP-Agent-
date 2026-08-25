/**
 * Print Time Prediction Model
 *
 * Uses ONNX Runtime to predict print time from geometry and settings.
 * Falls back to volumetric estimation when ML is unavailable.
 */

import { infer, loadModel as loadMLModel, type MLModel } from '../mlRuntime';

const MODEL_PATH = '/models/print_time.onnx';
let _model: MLModel | null = null;

export interface PrintTimeResult {
  /** Estimated print time in seconds */
  printTime: number;
  /** Estimated filament length in mm */
  filamentLength: number;
  /** Estimated filament volume in mm³ */
  filamentVolume: number;
  /** Number of layers */
  layerCount: number;
  /** Whether ML model was used */
  usedML: boolean;
}

/**
 * Load the print time prediction model
 */
export async function loadPrintTimeModel(): Promise<boolean> {
  try {
    _model = await loadMLModel(MODEL_PATH);
    return true;
  } catch {
    console.warn('[ML] Print time model not available, using rule-based fallback');
    return false;
  }
}

/**
 * Predict print time using ML or rule-based fallback
 */
export async function predictPrintTime(
  positions: Float32Array,
  options: {
    layerHeight?: number;
    nozzleDiameter?: number;
    printSpeed?: number;
    infillDensity?: number;
  } = {}
): Promise<PrintTimeResult> {
  const layerHeight = options.layerHeight || 0.2;
  const nozzleDiameter = options.nozzleDiameter || 0.4;
  const printSpeed = options.printSpeed || 60;
  const infillDensity = options.infillDensity || 0.2;

  if (_model) {
    try {
      return await predictWithML(positions, layerHeight, nozzleDiameter, printSpeed, infillDensity);
    } catch (err) {
      console.warn('[ML] Print time prediction failed, falling back:', err);
    }
  }

  return predictWithRules(positions, layerHeight, nozzleDiameter, printSpeed, infillDensity);
}

/**
 * ML-based prediction
 */
async function predictWithML(
  positions: Float32Array,
  layerHeight: number,
  nozzleDiameter: number,
  printSpeed: number,
  infillDensity: number
): Promise<PrintTimeResult> {
  const vertexCount = positions.length / 3;

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  const inputs = {
    size: new Float32Array([sizeX, sizeY, sizeZ]),
    settings: new Float32Array([layerHeight, nozzleDiameter, printSpeed, infillDensity]),
  };

  const inputShapes = {
    size: [1, 3],
    settings: [1, 4],
  };

  const results = await infer(MODEL_PATH, inputs, inputShapes);
  const prediction = results.output || new Float32Array([0]);

  const printTime = prediction[0] || 0;
  const layerCount = Math.ceil(sizeZ / layerHeight);
  const filamentVolume = printTime * 0.1; // rough estimate
  const filamentLength = filamentVolume / (Math.PI * (nozzleDiameter / 2) ** 2);

  return {
    printTime,
    filamentLength,
    filamentVolume,
    layerCount,
    usedML: true,
  };
}

/**
 * Rule-based prediction (fallback)
 * Uses volumetric estimation
 */
function predictWithRules(
  positions: Float32Array,
  layerHeight: number,
  nozzleDiameter: number,
  printSpeed: number,
  infillDensity: number
): PrintTimeResult {
  const vertexCount = positions.length / 3;

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  // Estimate model volume (rough bounding box * fill factor)
  const boundingVolume = sizeX * sizeY * sizeZ;
  const fillFactor = 0.3; // typical fill for organic shapes
  const modelVolume = boundingVolume * fillFactor;

  // Layer count
  const layerCount = Math.ceil(sizeZ / layerHeight);

  // Filament volume (infill + walls)
  const wallThickness = 1.2; // 3 perimeters * 0.4mm
  const wallVolume = (sizeX * sizeY + sizeX * sizeZ + sizeY * sizeZ) * 2 * wallThickness;
  const infillVolume = modelVolume * infillDensity;
  const totalFilamentVolume = wallVolume + infillVolume;

  // Filament length
  const filamentRadius = nozzleDiameter / 2;
  const filamentLength = totalFilamentVolume / (Math.PI * filamentRadius * filamentRadius);

  // Print time estimation
  // Layer time = (perimeter length + infill length) / speed
  const perimeterLength = (sizeX + sizeY) * 2 * layerCount;
  const infillLength = Math.sqrt(infillDensity) * sizeX * sizeY / layerHeight;
  const totalLength = perimeterLength + infillLength;

  const printTime = totalLength / printSpeed; // seconds

  return {
    printTime,
    filamentLength,
    filamentVolume: totalFilamentVolume,
    layerCount,
    usedML: false,
  };
}

/**
 * Check if ML model is loaded
 */
export function isPrintTimeModelLoaded(): boolean {
  return _model !== null;
}
