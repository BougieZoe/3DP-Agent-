/**
 * ONNX Runtime Web Integration
 *
 * Provides on-device ML inference:
 * - Model loading with backend selection (WebGPU > WebNN > WASM)
 * - Inference execution
 * - Resource management
 */

export type MLBackend = 'webgpu' | 'webnn' | 'wasm';

export interface MLModel {
  name: string;
  inputNames: string[];
  outputNames: string[];
}

export interface MLRuntimeContext {
  backend: MLBackend;
  isReady: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ort: any = null;
let _sessionCache: Map<string, any> = new Map();
let _backend: MLBackend | null = null;

/**
 * Initialize ONNX Runtime
 */
async function initORT(): Promise<any> {
  if (_ort) return _ort;

  try {
    // Dynamic import to avoid bundle bloat — onnxruntime-web is an optional dependency
    const ort = await import(/* webpackIgnore: true */ 'onnxruntime-web');
    _ort = ort;
    return _ort;
  } catch (err) {
    console.warn('[ML] ONNX Runtime not available:', err);
    return null;
  }
}

/**
 * Select the best available backend
 */
async function selectBackend(): Promise<MLBackend> {
  if (_backend) return _backend;

  // Check WebGPU
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        _backend = 'webgpu';
        return _backend;
      }
    } catch {
      // Fall through
    }
  }

  // Check WebNN
  if (typeof navigator !== 'undefined' && 'ml' in navigator) {
    _backend = 'webnn';
    return _backend;
  }

  // Fallback to WASM
  _backend = 'wasm';
  return _backend;
}

/**
 * Load an ONNX model
 */
export async function loadModel(
  modelPath: string,
  options: { backend?: MLBackend } = {}
): Promise<MLModel> {
  const ort = await initORT();
  if (!ort) {
    throw new Error('ONNX Runtime not available');
  }

  const backend = options.backend || await selectBackend();

  // Configure execution provider
  const sessionOptions = {
    executionProviders: [backend] as string[],
    graphOptimizationLevel: 'all' as const,
  };

  let session = _sessionCache.get(modelPath);
  if (!session) {
    session = await ort.InferenceSession.create(modelPath, sessionOptions);
    _sessionCache.set(modelPath, session);
  }

  return {
    name: modelPath.split('/').pop() || modelPath,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
  };
}

/**
 * Run inference on a loaded model
 */
export async function infer(
  modelPath: string,
  inputs: Record<string, Float32Array | number[]>,
  inputShapes: Record<string, number[]>
): Promise<Record<string, Float32Array>> {
  const ort = await initORT();
  if (!ort) {
    throw new Error('ONNX Runtime not available');
  }

  const session = _sessionCache.get(modelPath);
  if (!session) {
    throw new Error(`Model not loaded: ${modelPath}`);
  }

  // Create tensors
  const feeds: Record<string, any> = {};
  for (const [name, data] of Object.entries(inputs)) {
    const shape = inputShapes[name];
    if (!shape) throw new Error(`Missing shape for input: ${name}`);
    feeds[name] = new ort.Tensor('float32', Float32Array.from(data), shape);
  }

  // Run inference
  const results = await session.run(feeds);

  // Extract outputs
  const outputs: Record<string, Float32Array> = {};
  for (const [name, tensor] of Object.entries(results) as [string, any][]) {
    outputs[name] = tensor.data;
  }

  return outputs;
}

/**
 * Get current backend
 */
export function getCurrentBackend(): MLBackend | null {
  return _backend;
}

/**
 * Check if ML is available
 */
export async function isMLAvailable(): Promise<boolean> {
  try {
    const ort = await initORT();
    return !!ort;
  } catch {
    return false;
  }
}

/**
 * Clear model cache
 */
export function clearModelCache(): void {
  for (const session of _sessionCache.values()) {
    if (session && typeof session.release === 'function') {
      session.release();
    }
  }
  _sessionCache.clear();
}
