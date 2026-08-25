/**
 * WebGPU Initialization Layer
 *
 * Provides WebGPU access for GPU-accelerated analysis:
 * - Thermal stress computation
 * - Wall thickness heatmap generation
 * - Support structure visualization
 *
 * Gracefully degrades to CPU fallback when WebGPU is unavailable.
 */

export interface WebGPUContext {
  device: GPUDevice;
  adapter: GPUAdapter;
  isSupported: boolean;
}

export interface ComputeBuffer {
  buffer: GPUBuffer;
  size: number;
}

// Singleton
let _ctx: WebGPUContext | null = null;
let _initPromise: Promise<WebGPUContext | null> | null = null;

/**
 * Check if WebGPU is available in the browser
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Initialize WebGPU context (lazy, singleton)
 * Returns null if WebGPU is not available
 */
export async function initWebGPU(): Promise<WebGPUContext | null> {
  if (_ctx) return _ctx;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (!isWebGPUSupported()) {
      console.warn('[WebGPU] Not supported in this browser');
      return null;
    }

    try {
      const adapter = await navigator.gpu!.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        console.warn('[WebGPU] No adapter found');
        return null;
      }

      const device = await adapter.requestDevice({
        requiredFeatures: [],
        requiredLimits: {},
      });

      device.lost.then((info) => {
        console.error('[WebGPU] Device lost:', info.message);
        _ctx = null;
      });

      _ctx = { device, adapter, isSupported: true };
      return _ctx;
    } catch (err) {
      console.warn('[WebGPU] Initialization failed:', err);
      return null;
    }
  })();

  return _initPromise;
}

/**
 * Create a storage buffer for compute shader input/output
 */
export function createStorageBuffer(
  ctx: WebGPUContext,
  data: Float32Array | Uint32Array,
  label?: string
): ComputeBuffer {
  const buffer = ctx.device.createBuffer({
    label: label ?? 'storage-buffer',
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  ctx.device.queue.writeBuffer(buffer, 0, data);
  return { buffer, size: data.byteLength };
}

/**
 * Create a readback buffer (for reading compute results back to CPU)
 */
export function createReadbackBuffer(
  ctx: WebGPUContext,
  size: number,
  label?: string
): GPUBuffer {
  return ctx.device.createBuffer({
    label: label ?? 'readback-buffer',
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
}

/**
 * Read data back from a GPU buffer to CPU
 */
export async function readBuffer(
  ctx: WebGPUContext,
  buffer: GPUBuffer,
  size: number
): Promise<Float32Array> {
  const readback = createReadbackBuffer(ctx, size);

  const commandEncoder = ctx.device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(buffer, 0, readback, 0, size);
  ctx.device.queue.submit([commandEncoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  readback.destroy();

  return data;
}

/**
 * Create a compute pipeline from WGSL shader source
 */
export function createComputePipeline(
  ctx: WebGPUContext,
  shaderSource: string,
  entryPoint: string = 'main'
): GPUComputePipeline {
  const shaderModule = ctx.device.createShaderModule({
    label: 'compute-shader',
    code: shaderSource,
  });

  return ctx.device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint,
    },
  });
}

/**
 * Cleanup WebGPU context
 */
export function destroyWebGPU(): void {
  if (_ctx) {
    _ctx.device.destroy();
    _ctx = null;
  }
  _initPromise = null;
}
