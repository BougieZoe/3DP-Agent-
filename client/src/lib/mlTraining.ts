/**
 * ML Model Training Module
 *
 * Client-side ML training capabilities:
 * - Collect training data from analysis results
 * - Train simple models using TensorFlow.js
 * - Export trained models as ONNX
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingSample {
  /** Geometry features */
  features: Float32Array;
  /** Expected output */
  label: Float32Array;
  /** Sample metadata */
  metadata: {
    fileName: string;
    timestamp: string;
    material?: string;
    printerId?: string;
    printSuccess?: boolean;
  };
}

export interface TrainingConfig {
  /** Model type to train */
  modelType: 'wall_thickness' | 'overhang' | 'print_time' | 'support';
  /** Learning rate */
  learningRate: number;
  /** Number of epochs */
  epochs: number;
  /** Batch size */
  batchSize: number;
  /** Validation split */
  validationSplit: number;
  /** Early stopping patience */
  earlyStoppingPatience: number;
}

export interface TrainingProgress {
  epoch: number;
  loss: number;
  valLoss?: number;
  accuracy?: number;
  valAccuracy?: number;
  status: 'training' | 'validating' | 'complete' | 'error';
  message?: string;
}

export interface TrainedModel {
  id: string;
  modelType: string;
  config: TrainingConfig;
  metrics: {
    finalLoss: number;
    finalValLoss?: number;
    finalAccuracy?: number;
    trainingTime: number;
    sampleCount: number;
  };
  modelData: ArrayBuffer;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Feature Extraction
// ---------------------------------------------------------------------------

/**
 * Extract features from geometry for training
 */
export function extractFeatures(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  modelType: string
): Float32Array {
  const vertexCount = positions.length / 3;
  const faceCount = indices.length / 3;

  switch (modelType) {
    case 'wall_thickness':
      return extractWallThicknessFeatures(positions, normals, vertexCount);
    case 'overhang':
      return extractOverhangFeatures(positions, normals, indices, faceCount);
    case 'print_time':
      return extractPrintTimeFeatures(positions, vertexCount);
    case 'support':
      return extractSupportFeatures(positions, normals, indices, faceCount);
    default:
      return new Float32Array(0);
  }
}

function extractWallThicknessFeatures(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number
): Float32Array {
  // Features: [curvature, edge_distance, normal_variance]
  const features = new Float32Array(vertexCount * 3);

  for (let i = 0; i < vertexCount; i++) {
    const idx = i * 3;
    // Curvature proxy from normal z-component
    features[idx] = Math.abs(normals[idx + 2]);
    // Edge distance proxy
    features[idx + 1] = Math.sqrt(positions[idx] ** 2 + positions[idx + 1] ** 2);
    // Normal variance
    features[idx + 2] = normals[idx] ** 2 + normals[idx + 1] ** 2;
  }

  return features;
}

function extractOverhangFeatures(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  faceCount: number
): Float32Array {
  // Features per face: [centroid_z, normal_angle, face_area]
  const features = new Float32Array(faceCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3] * 3;
    const i1 = indices[f * 3 + 1] * 3;
    const i2 = indices[f * 3 + 2] * 3;
    const idx = f * 3;

    // Centroid Z
    features[idx] = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;

    // Normal angle from vertical
    const nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
    features[idx + 1] = Math.acos(Math.min(1, Math.max(-1, nz)));

    // Face area
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    features[idx + 2] = Math.sqrt(
      (ay * bz - az * by) ** 2 +
      (az * bx - ax * bz) ** 2 +
      (ax * by - ay * bx) ** 2
    ) / 2;
  }

  return features;
}

function extractPrintTimeFeatures(
  positions: Float32Array,
  vertexCount: number
): Float32Array {
  // Features: [bounding_box, volume_estimate, surface_area_estimate]
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  return new Float32Array([
    sizeX, sizeY, sizeZ,
    sizeX * sizeY * sizeZ * 0.3, // volume estimate
    (sizeX * sizeY + sizeX * sizeZ + sizeY * sizeZ) * 2, // surface area
  ]);
}

function extractSupportFeatures(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  faceCount: number
): Float32Array {
  // Combine overhang and geometry features
  const overhangFeatures = extractOverhangFeatures(positions, normals, indices, faceCount);

  // Add bounding box info
  const vertexCount = positions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }

  // Pad features with bbox info repeated for each face
  const features = new Float32Array(faceCount * 6);
  for (let f = 0; f < faceCount; f++) {
    features[f * 6] = overhangFeatures[f * 3];
    features[f * 6 + 1] = overhangFeatures[f * 3 + 1];
    features[f * 6 + 2] = overhangFeatures[f * 3 + 2];
    features[f * 6 + 3] = maxX - minX;
    features[f * 6 + 4] = maxY - minY;
    features[f * 6 + 5] = maxZ - minZ;
  }

  return features;
}

// ---------------------------------------------------------------------------
// Training Data Collection
// ---------------------------------------------------------------------------

const STORAGE_KEY = '3dp_agent_training_data';

/**
 * Save training sample to local storage
 */
export function saveTrainingSample(sample: TrainingSample): void {
  const existing = getTrainingSamples();
  existing.push(sample);

  // Keep max 10000 samples
  if (existing.length > 10000) {
    existing.splice(0, existing.length - 10000);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

/**
 * Get all training samples from local storage
 */
export function getTrainingSamples(): TrainingSample[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Clear all training data
 */
export function clearTrainingData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get training data stats
 */
export function getTrainingStats(): {
  totalSamples: number;
  byModelType: Record<string, number>;
  byMaterial: Record<string, number>;
} {
  const samples = getTrainingSamples();
  const byModelType: Record<string, number> = {};
  const byMaterial: Record<string, number> = {};

  for (const sample of samples) {
    const type = sample.metadata.fileName.split('.').pop() || 'unknown';
    byModelType[type] = (byModelType[type] || 0) + 1;

    const material = sample.metadata.material || 'unknown';
    byMaterial[material] = (byMaterial[material] || 0) + 1;
  }

  return {
    totalSamples: samples.length,
    byModelType,
    byMaterial,
  };
}

// ---------------------------------------------------------------------------
// Simple Neural Network (No TensorFlow.js dependency)
// ---------------------------------------------------------------------------

/**
 * Simple feedforward neural network for training
 */
export class SimpleNN {
  private weights: Float32Array[];
  private biases: Float32Array[];
  private config: TrainingConfig;

  constructor(inputSize: number, hiddenSize: number, outputSize: number, config: TrainingConfig) {
    this.config = config;

    // Xavier initialization
    const w1 = new Float32Array(inputSize * hiddenSize);
    const w2 = new Float32Array(hiddenSize * outputSize);
    const b1 = new Float32Array(hiddenSize);
    const b2 = new Float32Array(outputSize);

    for (let i = 0; i < w1.length; i++) {
      w1[i] = (Math.random() * 2 - 1) * Math.sqrt(2 / inputSize);
    }
    for (let i = 0; i < w2.length; i++) {
      w2[i] = (Math.random() * 2 - 1) * Math.sqrt(2 / hiddenSize);
    }

    this.weights = [w1, w2];
    this.biases = [b1, b2];
  }

  /**
   * Forward pass
   */
  predict(input: Float32Array): Float32Array {
    const hidden = this.forwardLayer(input, this.weights[0], this.biases[0], true);
    return this.forwardLayer(hidden, this.weights[1], this.biases[1], false);
  }

  /**
   * Train on batch
   */
  trainBatch(inputs: Float32Array[], labels: Float32Array[]): number {
    const lr = this.config.learningRate;
    let totalLoss = 0;

    for (let s = 0; s < inputs.length; s++) {
      const input = inputs[s];
      const label = labels[s];

      // Forward
      const hidden = this.forwardLayer(input, this.weights[0], this.biases[0], true);
      const output = this.forwardLayer(hidden, this.weights[1], this.biases[1], false);

      // Loss (MSE)
      for (let i = 0; i < output.length; i++) {
        totalLoss += (output[i] - label[i]) ** 2;
      }

      // Backward
      const outputGrad = new Float32Array(output.length);
      for (let i = 0; i < output.length; i++) {
        outputGrad[i] = 2 * (output[i] - label[i]) / output.length;
      }

      // Update weights
      for (let i = 0; i < hidden.length; i++) {
        for (let j = 0; j < output.length; j++) {
          this.weights[1][i * output.length + j] -= lr * hidden[i] * outputGrad[j];
        }
      }
      for (let j = 0; j < output.length; j++) {
        this.biases[1][j] -= lr * outputGrad[j];
      }
    }

    return totalLoss / inputs.length;
  }

  private forwardLayer(
    input: Float32Array,
    weights: Float32Array,
    biases: Float32Array,
    relu: boolean
  ): Float32Array {
    const inputSize = input.length;
    const outputSize = biases.length;
    const output = new Float32Array(outputSize);

    for (let j = 0; j < outputSize; j++) {
      let sum = biases[j];
      for (let i = 0; i < inputSize; i++) {
        sum += input[i] * weights[i * outputSize + j];
      }
      output[j] = relu ? Math.max(0, sum) : sum; // ReLU or linear
    }

    return output;
  }

  /**
   * Export model as ArrayBuffer
   */
  export(): ArrayBuffer {
    const totalSize = this.weights.reduce((sum, w) => sum + w.length, 0) +
                      this.biases.reduce((sum, b) => sum + b.length, 0);
    const buffer = new ArrayBuffer(totalSize * 4);
    const view = new Float32Array(buffer);

    let offset = 0;
    for (const w of this.weights) {
      view.set(w, offset);
      offset += w.length;
    }
    for (const b of this.biases) {
      view.set(b, offset);
      offset += b.length;
    }

    return buffer;
  }
}

// ---------------------------------------------------------------------------
// Training Loop
// ---------------------------------------------------------------------------

/**
 * Train a model with progress callback
 */
export async function trainModel(
  samples: TrainingSample[],
  config: TrainingConfig,
  onProgress: (progress: TrainingProgress) => void
): Promise<TrainedModel> {
  const startTime = Date.now();

  // Determine input/output sizes from first sample
  const inputSize = samples[0].features.length;
  const outputSize = samples[0].label.length;

  const nn = new SimpleNN(inputSize, 64, outputSize, config);

  // Shuffle samples
  const shuffled = [...samples].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * (1 - config.validationSplit));
  const trainSamples = shuffled.slice(0, splitIdx);
  const valSamples = shuffled.slice(splitIdx);

  let bestValLoss = Infinity;
  let patienceCounter = 0;

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    // Train epoch
    let trainLoss = 0;
    const batches = chunkArray(trainSamples, config.batchSize);

    for (const batch of batches) {
      const inputs = batch.map(s => s.features);
      const labels = batch.map(s => s.label);
      trainLoss += nn.trainBatch(inputs, labels);
    }
    trainLoss /= batches.length;

    // Validate
    let valLoss = 0;
    if (valSamples.length > 0) {
      for (const sample of valSamples) {
        const pred = nn.predict(sample.features);
        for (let i = 0; i < pred.length; i++) {
          valLoss += (pred[i] - sample.label[i]) ** 2;
        }
      }
      valLoss /= valSamples.length;
    }

    onProgress({
      epoch: epoch + 1,
      loss: trainLoss,
      valLoss: valSamples.length > 0 ? valLoss : undefined,
      status: 'training',
    });

    // Early stopping
    if (valSamples.length > 0 && valLoss < bestValLoss) {
      bestValLoss = valLoss;
      patienceCounter = 0;
    } else {
      patienceCounter++;
      if (patienceCounter >= config.earlyStoppingPatience) {
        break;
      }
    }

    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const trainingTime = Date.now() - startTime;

  onProgress({
    epoch: config.epochs,
    loss: 0,
    status: 'complete',
    message: `Training complete in ${(trainingTime / 1000).toFixed(1)}s`,
  });

  return {
    id: `model_${Date.now().toString(36)}`,
    modelType: config.modelType,
    config,
    metrics: {
      finalLoss: bestValLoss,
      trainingTime,
      sampleCount: samples.length,
    },
    modelData: nn.export(),
    createdAt: new Date().toISOString(),
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
