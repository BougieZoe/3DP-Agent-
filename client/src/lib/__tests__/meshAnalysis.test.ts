import { describe, expect, it } from 'vitest';
import { createMockMeshAdapter } from '@/design/generator';
import { parseSTL } from '@/lib/stlParser';
import { runCadAnalysis } from '@/lib/cadAnalysis';
import { MATERIALS } from '@/lib/materialState';

describe('mesh → analysis pipeline', () => {
  it('analyzes a mock-generated mesh end to end', async () => {
    const provider = createMockMeshAdapter({ delayMs: 1 });
    const handle = await provider.submit({ prompt: 'a gear' });
    const state = await provider.poll(handle);
    expect(state.status).toBe('succeeded');
    if (state.status !== 'succeeded') return;
    if (state.payload.kind !== 'mesh') return;

    const geometry = parseSTL(state.payload.stlBytes);
    expect(geometry.attributes.position.count).toBeGreaterThan(0);

    const material = Object.values(MATERIALS)[0];
    const result = runCadAnalysis(geometry, {
      fileName: 'gear.stl',
      prompt: 'a gear',
      material,
      language: 'en',
    });
    expect(result.unified.metrics.result?.meshVolumeMm3).toBeGreaterThan(0);
    expect(result.gate.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.unified.validation.result).toBeDefined();
  });
});
