import { describe, expect, it } from 'vitest';
import {
  getArtifactSemantics,
  isRenderingOnlyArtifact,
  isSerializableArtifact,
  isWorkerSafeArtifact,
} from '../artifacts';

describe('artifact semantics', () => {
  it('marks ModelAnalysis as a serializable operational artifact', () => {
    const semantics = getArtifactSemantics('model_analysis');

    expect(semantics.stability).toBe('foundational');
    expect(semantics.mutability).toBe('immutable');
    expect(isSerializableArtifact('model_analysis')).toBe(true);
    expect(isWorkerSafeArtifact('model_analysis')).toBe(true);
  });

  it('marks Three.js render artifacts as runtime-bound and rendering-only', () => {
    expect(isSerializableArtifact('render_mesh')).toBe(false);
    expect(isWorkerSafeArtifact('render_mesh')).toBe(false);
    expect(isRenderingOnlyArtifact('render_mesh')).toBe(true);

    const semantics = getArtifactSemantics('stl_analysis_result');
    expect(semantics.stability).toBe('transitional');
    expect(semantics.replayability).toBe('runtime_bound');
  });
});
