/**
 * Wall Thickness Prediction Model
 *
 * Uses ONNX Runtime to predict per-vertex wall thickness from geometry.
 * Falls back to rule-based estimation when ML is unavailable.
 */

import { infer, loadModel as loadMLModel, type MLModel } from '../mlRuntime';

const MODEL_PATH = '/models/wall_thickness.onnx';
let _model: MLModel | null = null;

export interface WallThicknessResult {
  /** Per-vertex wall thickness values (mm) */
  thickness: Float32Array;
  /** Minimum wall thickness found */
  minWidth: number;
  /** Maximum wall thickness found */
  maxWidth: number;
  /** Average wall thickness */
  avgWidth: number;
  /** Vertices below minimum threshold */
  thinVertices: number;
  /** Whether ML model was used */
  usedML: boolean;
}

/**
 * Load the wall thickness prediction model
 */
export async function loadWallThicknessModel(): Promise<boolean> {
  try {
    _model = await loadMLModel(MODEL_PATH);
    return true;
  } catch {
    console.warn('[ML] Wall thickness model not available, using rule-based fallback');
    return false;
  }
}

/**
 * Predict wall thickness using ML or rule-based fallback
 */
export async function predictWallThickness(
  positions: Float32Array,
  normals: Float32Array,
  options: { minThickness?: number } = {}
): Promise<WallThicknessResult> {
  const minThreshold = options.minThickness || 0.8; // mm

  if (_model) {
    try {
      return await predictWithML(positions, normals, minThreshold);
    } catch (err) {
      console.warn('[ML] Wall thickness prediction failed, falling back:', err);
    }
  }

  return predictWithRules(positions, normals, minThreshold);
}

/**
 * ML-based prediction
 */
async function predictWithML(
  positions: Float32Array,
  normals: Float32Array,
  minThreshold: number
): Promise<WallThicknessResult> {
  const vertexCount = positions.length / 3;

  // Prepare input tensors
  const inputs = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  };

  const inputShapes = {
    positions: [vertexCount, 3],
    normals: [vertexCount, 3],
  };

  // Run inference
  const results = await infer(MODEL_PATH, inputs, inputShapes);
  const thickness = results.output || new Float32Array(vertexCount);

  // Calculate statistics
  let minWidth = Infinity;
  let maxWidth = -Infinity;
  let sum = 0;
  let thinVertices = 0;

  for (let i = 0; i < thickness.length; i++) {
    const t = thickness[i];
    if (t < minWidth) minWidth = t;
    if (t > maxWidth) maxWidth = t;
    sum += t;
    if (t < minThreshold) thinVertices++;
  }

  return {
    thickness,
    minWidth: minWidth === Infinity ? 0 : minWidth,
    maxWidth: maxWidth === -Infinity ? 0 : maxWidth,
    avgWidth: thickness.length > 0 ? sum / thickness.length : 0,
    thinVertices,
    usedML: true,
  };
}

/**
 * Rule-based prediction (fallback)
 * Estimates thickness from local geometry curvature
 */
function predictWithRules(
  positions: Float32Array,
  normals: Float32Array,
  minThreshold: number
): WallThicknessResult {
  const vertexCount = positions.length / 3;
  const thickness = new Float32Array(vertexCount);

  // Simple heuristic: thickness inversely proportional to curvature
  // Curvature estimated from normal variation
  for (let i = 0; i < vertexCount; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    // Use normal z-component as proxy for local flatness
    // Flat regions = thick walls, curved regions = thin walls
    const flatness = Math.abs(nz);
    thickness[i] = 0.5 + flatness * 2.0; // 0.5mm to 2.5mm range
  }

  // Calculate statistics
  let minWidth = Infinity;
  let maxWidth = -Infinity;
  let sum = 0;
  let thinVertices = 0;

  for (let i = 0; i < thickness.length; i++) {
    const t = thickness[i];
    if (t < minWidth) minWidth = t;
    if (t > maxWidth) maxWidth = t;
    sum += t;
    if (t < minThreshold) thinVertices++;
  }

  return {
    thickness,
    minWidth: minWidth === Infinity ? 0 : minWidth,
    maxWidth: maxWidth === -Infinity ? 0 : maxWidth,
    avgWidth: thickness.length > 0 ? sum / thickness.length : 0,
    thinVertices,
    usedML: false,
  };
}

/**
 * Check if ML model is loaded
 */
export function isWallThicknessModelLoaded(): boolean {
  return _model !== null;
}
