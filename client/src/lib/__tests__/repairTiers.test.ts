import { describe, it, expect } from 'vitest';
import { classifyBridgeError, pickWasmSuggestion } from '../repairTiers';
import type { GeometrySuggestion } from '@/components/causality/counterfactualEngine';

const sug = (over: Partial<GeometrySuggestion>): GeometrySuggestion =>
  ({
    id: 's1',
    type: 'thicken_wall',
    label: 'thicken',
    description: 'd',
    affectedPositions: [{ x: 0, y: 0, z: 0 }],
    riskReduction: 50,
    thermalImprovement: 0,
    supportChange: 0,
    patternImpact: [],
    confidence: 0.8,
    chainComparison: [],
    ...over,
  }) as GeometrySuggestion;

describe('classifyBridgeError', () => {
  it.each([
    ['mesh process failed (HTTP 404)', 'bridge-absent'],
    ['mesh process failed (HTTP 500)', 'bridge-absent'],
    ['mesh process failed (HTTP 502)', 'bridge-absent'],
    ['mesh process failed (HTTP 503)', 'bridge-absent'],
    ['mesh process failed (HTTP 504)', 'bridge-absent'],
    ['bridge unavailable: BRIDGE_TOKEN not configured', 'bridge-absent'],
    ['Failed to fetch', 'bridge-absent'],
    ['Load failed', 'bridge-absent'],
  ])('marks %s as bridge-absent', (msg, expected) => {
    expect(classifyBridgeError(new Error(msg))).toBe(expected);
  });

  it('keeps real failures as repair-failed', () => {
    expect(classifyBridgeError(new Error('mesh process exited 1: oom'))).toBe('repair-failed');
    expect(classifyBridgeError(new Error('mesh process failed (HTTP 413)'))).toBe('repair-failed');
    expect(classifyBridgeError(new Error('STL too large'))).toBe('repair-failed');
  });
});

describe('pickWasmSuggestion', () => {
  it('picks the first thicken_wall suggestion with regions', () => {
    const s = sug({});
    expect(pickWasmSuggestion([sug({ type: 'add_support' }), s])).toBe(s);
  });

  it('returns null when nothing appliable', () => {
    expect(pickWasmSuggestion([])).toBeNull();
    expect(pickWasmSuggestion([sug({ type: 'add_support' })])).toBeNull();
    expect(pickWasmSuggestion([sug({ affectedPositions: [] })])).toBeNull();
  });
});
