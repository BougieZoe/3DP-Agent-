/**
 * The WASM repair has two implementations: manifold solid offset and a
 * per-vertex normal-offset fallback. The fallback must be labelled, not
 * silently passed off as the solid-offset result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { GeometrySuggestion } from '@/components/causality/counterfactualEngine';

vi.mock('manifold-3d', () => ({
  default: () => Promise.reject(new Error('manifold wasm unavailable')),
}));

import { applyRepairAsync, applyRepairWithMethodAsync } from '../meshRepair';

const suggestion = {
  id: 's1',
  type: 'thicken_wall',
  label: 'thicken',
  description: 'thicken thin wall',
  affectedPositions: [{ x: 5, y: 5, z: 5 }],
  riskReduction: 50,
  thermalImprovement: 0,
  supportChange: 0,
  patternImpact: [],
  confidence: 80,
  chainComparison: [],
} as GeometrySuggestion;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('applyRepairWithMethodAsync', () => {
  it('reports the normal-offset fallback when manifold cannot load', async () => {
    const original = new THREE.BoxGeometry(10, 10, 10);
    const result = await applyRepairWithMethodAsync(original, suggestion);

    expect(result.method).toBe('normal-fallback');
    expect(result.geometry).not.toBe(original);
    expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
  });

  it('keeps the geometry-only API backward compatible', async () => {
    const original = new THREE.BoxGeometry(10, 10, 10);
    const geometry = await applyRepairAsync(original, suggestion);
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
  });
});
