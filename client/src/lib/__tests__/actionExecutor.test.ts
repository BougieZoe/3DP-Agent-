import { describe, it, expect } from 'vitest';
import { executeIntent, type ExecutionContext } from '../actionExecutor';
import type { UserIntent } from '../intentParser';

const mockContext: ExecutionContext = {
  model: {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
    units: 'mm',
  },
  analysis: null,
  material: 'PLA',
  language: 'en',
};

describe('actionExecutor', () => {
  it('should execute analyze intent', async () => {
    const intent: UserIntent = {
      action: 'analyze',
      params: {},
      confidence: 0.9,
      raw: 'analyze this',
    };

    const result = await executeIntent(intent, mockContext);

    expect(result.success).toBe(true);
    expect(result.action).toBe('analyze');
  });

  it('should execute settings intent', async () => {
    const intent: UserIntent = {
      action: 'settings',
      params: { material: 'PETG', layerHeight: 0.2 },
      confidence: 0.9,
      raw: 'use PETG',
    };

    const result = await executeIntent(intent, mockContext);

    expect(result.success).toBe(true);
    expect(result.action).toBe('settings');
    expect(result.message).toContain('PETG');
  });

  it('should execute query intent', async () => {
    const intent: UserIntent = {
      action: 'query',
      params: { type: 'time' },
      confidence: 0.8,
      raw: 'how long?',
    };

    const result = await executeIntent(intent, mockContext);

    // Query fails when no analysis results available
    expect(result.success).toBe(false);
    expect(result.action).toBe('query');
  });

  it('should execute help intent', async () => {
    const intent: UserIntent = {
      action: 'help',
      params: {},
      confidence: 0.9,
      raw: 'help',
    };

    const result = await executeIntent(intent, mockContext);

    expect(result.success).toBe(true);
    expect(result.action).toBe('help');
  });

  it('should handle unknown action', async () => {
    const intent: UserIntent = {
      action: 'unknown' as any,
      params: {},
      confidence: 0.5,
      raw: 'unknown',
    };

    const result = await executeIntent(intent, mockContext);

    expect(result.success).toBe(false);
  });

  it('should fail when no model loaded', async () => {
    const intent: UserIntent = {
      action: 'analyze',
      params: {},
      confidence: 0.9,
      raw: 'analyze',
    };

    const result = await executeIntent(intent, { ...mockContext, model: null });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No model');
  });
});
