declare module 'onnxruntime-web' {
  export interface InferenceSession {
    inputNames: string[];
    outputNames: string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release(): void;
  }

  export interface Tensor {
    data: Float32Array;
    dims: number[];
    type: string;
  }

  export interface SessionOptions {
    executionProviders?: string[];
    graphOptimizationLevel?: 'disabled' | 'basic' | 'all';
  }

  export const Tensor: {
    new(type: string, data: Float32Array, dims: number[]): Tensor;
  };

  export function createSession(path: string, options?: SessionOptions): Promise<InferenceSession>;
}
