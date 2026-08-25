/**
 * Overhang Detection Model
 *
 * Uses ONNX Runtime to detect overhang regions from face normals.
 * Falls back to rule-based angle threshold when ML is unavailable.
 */

import { infer, loadModel as loadMLModel, type MLModel } from '../mlRuntime';

const MODEL_PATH = '/models/overhang.onnx';
let _model: MLModel | null = null;

export interface OverhangResult {
  /** Per-face overhang angle (degrees) */
  angles: Float32Array;
  /** Face indices that are overhangs */
  overhangFaces: number[];
  /** Total overhang area (mm²) */
  overhangArea: number;
  /** Maximum overhang angle */
  maxAngle: number;
  /** Whether ML model was used */
  usedML: boolean;
}

/**
 * Load the overhang detection model
 */
export async function loadOverhangModel(): Promise<boolean> {
  try {
    _model = await loadMLModel(MODEL_PATH);
    return true;
  } catch {
    console.warn('[ML] Overhang model not available, using rule-based fallback');
    return false;
  }
}

/**
 * Detect overhangs using ML or rule-based fallback
 */
export async function detectOverhangs(
  positions: Float32Array,
  normals: Float32Array,
  faceIndices: Uint32Array,
  options: { maxOverhangAngle?: number } = {}
): Promise<OverhangResult> {
  const maxAngle = options.maxOverhangAngle || 45; // degrees

  if (_model) {
    try {
      return await detectWithML(positions, normals, faceIndices, maxAngle);
    } catch (err) {
      console.warn('[ML] Overhang detection failed, falling back:', err);
    }
  }

  return detectWithRules(positions, normals, faceIndices, maxAngle);
}

/**
 * ML-based detection
 */
async function detectWithML(
  positions: Float32Array,
  normals: Float32Array,
  faceIndices: Uint32Array,
  maxAngle: number
): Promise<OverhangResult> {
  const faceCount = faceIndices.length / 3;

  // Prepare face centroids and normals
  const centroids = new Float32Array(faceCount * 3);
  const faceNormals = new Float32Array(faceCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const i0 = faceIndices[f * 3] * 3;
    const i1 = faceIndices[f * 3 + 1] * 3;
    const i2 = faceIndices[f * 3 + 2] * 3;

    // Centroid
    centroids[f * 3] = (positions[i0] + positions[i1] + positions[i2]) / 3;
    centroids[f * 3 + 1] = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
    centroids[f * 3 + 2] = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;

    // Average normal
    faceNormals[f * 3] = (normals[i0] + normals[i1] + normals[i2]) / 3;
    faceNormals[f * 3 + 1] = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
    faceNormals[f * 3 + 2] = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
  }

  const inputs = {
    centroids,
    normals: faceNormals,
  };

  const inputShapes = {
    centroids: [faceCount, 3],
    normals: [faceCount, 3],
  };

  const results = await infer(MODEL_PATH, inputs, inputShapes);
  const angles = results.angles || new Float32Array(faceCount);

  // Find overhang faces
  const overhangFaces: number[] = [];
  let totalArea = 0;
  let maxAng = 0;

  for (let f = 0; f < faceCount; f++) {
    const angle = angles[f];
    if (angle > maxAng) maxAng = angle;

    if (angle > maxAngle) {
      overhangFaces.push(f);
      // Approximate face area
      const i0 = faceIndices[f * 3] * 3;
      const i1 = faceIndices[f * 3 + 1] * 3;
      const i2 = faceIndices[f * 3 + 2] * 3;

      const ax = positions[i1] - positions[i0];
      const ay = positions[i1 + 1] - positions[i0 + 1];
      const az = positions[i1 + 2] - positions[i0 + 2];

      const bx = positions[i2] - positions[i0];
      const by = positions[i2 + 1] - positions[i0 + 1];
      const bz = positions[i2 + 2] - positions[i0 + 2];

      const crossX = ay * bz - az * by;
      const crossY = az * bx - ax * bz;
      const crossZ = ax * by - ay * bx;

      totalArea += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) / 2;
    }
  }

  return {
    angles,
    overhangFaces,
    overhangArea: totalArea,
    maxAngle: maxAng,
    usedML: true,
  };
}

/**
 * Rule-based detection (fallback)
 * Uses angle between face normal and build direction (Z-axis)
 */
function detectWithRules(
  positions: Float32Array,
  normals: Float32Array,
  faceIndices: Uint32Array,
  maxAngle: number
): OverhangResult {
  const faceCount = faceIndices.length / 3;
  const angles = new Float32Array(faceCount);
  const overhangFaces: number[] = [];
  let totalArea = 0;
  let maxAng = 0;

  for (let f = 0; f < faceCount; f++) {
    const i0 = faceIndices[f * 3] * 3;
    const i1 = faceIndices[f * 3 + 1] * 3;
    const i2 = faceIndices[f * 3 + 2] * 3;

    // Average normal
    const nx = (normals[i0] + normals[i1] + normals[i2]) / 3;
    const ny = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
    const nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;

    // Angle from vertical (Z-axis)
    // dot(normal, up) = nz, so angle = acos(nz)
    const angle = Math.acos(Math.min(1, Math.max(-1, nz))) * (180 / Math.PI);
    angles[f] = angle;

    if (angle > maxAng) maxAng = angle;

    if (angle > maxAngle) {
      overhangFaces.push(f);

      // Approximate face area
      const ax = positions[i1] - positions[i0];
      const ay = positions[i1 + 1] - positions[i0 + 1];
      const az = positions[i1 + 2] - positions[i0 + 2];

      const bx = positions[i2] - positions[i0];
      const by = positions[i2 + 1] - positions[i0 + 1];
      const bz = positions[i2 + 2] - positions[i0 + 2];

      const crossX = ay * bz - az * by;
      const crossY = az * bx - ax * bz;
      const crossZ = ax * by - ay * bx;

      totalArea += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) / 2;
    }
  }

  return {
    angles,
    overhangFaces,
    overhangArea: totalArea,
    maxAngle: maxAng,
    usedML: false,
  };
}

/**
 * Check if ML model is loaded
 */
export function isOverhangModelLoaded(): boolean {
  return _model !== null;
}
