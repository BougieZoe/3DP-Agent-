/// <reference lib="webworker" />
import { parseSTL } from './stlParser';

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const geometry = parseSTL(e.data);
    const position = geometry.attributes.position.array as Float32Array;
    const normal = geometry.attributes.normal.array as Float32Array;
    const index = (geometry.index?.array ?? new Uint32Array()) as Uint32Array;
    self.postMessage({ position, normal, index }, [
      position.buffer,
      normal.buffer,
      index.buffer,
    ]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
