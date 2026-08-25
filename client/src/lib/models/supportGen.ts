/**
 * Support Generation Model
 *
 * Uses ONNX Runtime to predict optimal support structures.
 * Falls back to rule-based overhang detection when ML is unavailable.
 */

import { infer, loadModel as loadMLModel, type MLModel } from '../mlRuntime';

const MODEL_PATH = '/models/support_gen.onnx';
let _model: MLModel | null = null;

export interface SupportPoint {
  /** Position of support contact point */
  position: [number, number, number];
  /** Normal direction at contact */
  normal: [number, number, number];
  /** Support type */
  type: 'tree' | 'linear' | 'organic';
  /** Confidence score */
  confidence: number;
}

export interface SupportGenResult {
  /** Generated support points */
  supports: SupportPoint[];
  /** Estimated support volume (mm³) */
  volume: number;
  /** Estimated support time (seconds) */
  printTime: number;
  /** Whether ML model was used */
  usedML: boolean;
}

/**
 * Load the support generation model
 */
export async function loadSupportGenModel(): Promise<boolean> {
  try {
    _model = await loadMLModel(MODEL_PATH);
    return true;
  } catch {
    console.warn('[ML] Support generation model not available, using rule-based fallback');
    return false;
  }
}

/**
 * Generate supports using ML or rule-based fallback
 */
export async function generateSupports(
  positions: Float32Array,
  normals: Float32Array,
  faceIndices: Uint32Array,
  options: { maxOverhangAngle?: number; supportDensity?: number } = {}
): Promise<SupportGenResult> {
  const maxAngle = options.maxOverhangAngle || 45;
  const density = options.supportDensity || 0.5;

  if (_model) {
    try {
      return await generateWithML(positions, normals, faceIndices, maxAngle, density);
    } catch (err) {
      console.warn('[ML] Support generation failed, falling back:', err);
    }
  }

  return generateWithRules(positions, normals, faceIndices, maxAngle, density);
}

/**
 * ML-based support generation
 */
async function generateWithML(
  positions: Float32Array,
  normals: Float32Array,
  faceIndices: Uint32Array,
  maxAngle: number,
  density: number
): Promise<SupportGenResult> {
  const faceCount = faceIndices.length / 3;

  // Prepare face data
  const centroids = new Float32Array(faceCount * 3);
  const faceNormals = new Float32Array(faceCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const i0 = faceIndices[f * 3] * 3;
    const i1 = faceIndices[f * 3 + 1] * 3;
    const i2 = faceIndices[f * 3 + 2] * 3;

    centroids[f * 3] = (positions[i0] + positions[i1] + positions[i2]) / 3;
    centroids[f * 3 + 1] = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
    centroids[f * 3 + 2] = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;

    faceNormals[f * 3] = (normals[i0] + normals[i1] + normals[i2]) / 3;
    faceNormals[f * 3 + 1] = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
    faceNormals[f * 3 + 2] = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
  }

  const inputs = {
    centroids,
    normals: faceNormals,
    config: new Float32Array([maxAngle, density]),
  };

  const inputShapes = {
    centroids: [faceCount, 3],
    normals: [faceCount, 3],
    config: [1, 2],
  };

  const results = await infer(MODEL_PATH, inputs, inputShapes);
  const supportData = results.supports || new Float32Array(0);

  // Parse ML output into support points
  const supports: SupportPoint[] = [];
  const pointCount = supportData.length / 7; // x,y,z,nx,ny,nz,confidence

  for (let i = 0; i < pointCount; i++) {
    const idx = i * 7;
    supports.push({
      position: [supportData[idx], supportData[idx + 1], supportData[idx + 2]],
      normal: [supportData[idx + 3], supportData[idx + 4], supportData[idx + 5]],
      type: 'tree',
      confidence: supportData[idx + 6],
    });
  }

  // Estimate volume and time
  const volume = supports.length * 50; // rough estimate
  const printTime = supports.length * 2; // rough estimate

  return {
    supports,
    volume,
    printTime,
    usedML: true,
  };
}

/**
 * Rule-based support generation (fallback)
 * Places supports at overhang vertices
 */
function generateWithRules(
  positions: Float32Array,
  normals: Float32Array,
  faceIndices: Uint32Array,
  maxAngle: number,
  density: number
): SupportGenResult {
  const faceCount = faceIndices.length / 3;
  const supports: SupportPoint[] = [];
  const minConfidence = 1 - density;

  for (let f = 0; f < faceCount; f++) {
    const i0 = faceIndices[f * 3] * 3;
    const i1 = faceIndices[f * 3 + 1] * 3;
    const i2 = faceIndices[f * 3 + 2] * 3;

    // Average normal
    const nx = (normals[i0] + normals[i1] + normals[i2]) / 3;
    const ny = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
    const nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;

    // Angle from vertical
    const angle = Math.acos(Math.min(1, Math.max(-1, nz))) * (180 / Math.PI);

    if (angle > maxAngle) {
      // Centroid
      const cx = (positions[i0] + positions[i1] + positions[i2]) / 3;
      const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
      const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;

      const confidence = (angle - maxAngle) / (90 - maxAngle);

      if (confidence >= minConfidence) {
        supports.push({
          position: [cx, cy, cz],
          normal: [nx, ny, nz],
          type: 'linear',
          confidence,
        });
      }
    }
  }

  // Estimate volume and time
  const volume = supports.length * 50;
  const printTime = supports.length * 2;

  return {
    supports,
    volume,
    printTime,
    usedML: false,
  };
}

/**
 * Check if ML model is loaded
 */
export function isSupportGenModelLoaded(): boolean {
  return _model !== null;
}
