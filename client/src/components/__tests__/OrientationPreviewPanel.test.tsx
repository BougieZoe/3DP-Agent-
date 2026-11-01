// @vitest-environment happy-dom
/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as THREE from 'three';
import { OrientationPreviewPanel } from '@/components/OrientationPreviewPanel';
import { MATERIALS } from '@shared/domain/material';
import type { UploadedModel } from '@/components/STLUploadHandler';
import type { OrientationCandidate, OrientationSuggestion } from '@/lib/autoOrient';

const suggestOrientation = vi.fn((_g: THREE.BufferGeometry, _t: number): OrientationSuggestion => {
  const candidate: OrientationCandidate = {
    axis: null, degrees: 0, label: 'current',
    overhangRatio: 0.1, overhangFaces: 1, buildHeightMm: 10,
    baseContactAreaMm2: 100, trueContactAreaMm2: 90,
    baseContactOk: true, footprintMm2: 200, baseContactFraction: 0.5,
  };
  return {
    candidates: [candidate], chosen: candidate, rotatedGeometry: null,
    rotated: false, verdict: 'kept', reason: null, tallSlender: false,
  };
});

vi.mock('@/lib/autoOrient', async importOriginal => {
  const mod = await importOriginal<typeof import('@/lib/autoOrient')>();
  return { ...mod, suggestOrientation: (...args: Parameters<typeof mod.suggestOrientation>) =>
    suggestOrientation(...args) };
});

const model = {
  geometry: new THREE.BufferGeometry(),
  fileName: 'probe.stl',
  unifiedAnalysis: null,
} as unknown as UploadedModel;

describe('OrientationPreviewPanel', () => {
  beforeEach(() => {
    // happy-dom's rAF is slow; drive it through a task so the test's
    // awaited frames resolve quickly and deterministically.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0),
    );
    suggestOrientation.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the busy state before suggestOrientation runs (INP fix)', async () => {
    render(
      <OrientationPreviewPanel
        model={model}
        material={MATERIALS.PLA}
        language="en"
        onAccept={() => {}}
      />,
    );

    let busyShownWhenCalled = false;
    suggestOrientation.mockImplementation(() => {
      busyShownWhenCalled = screen.queryAllByText(/RE-ANALYZING/).length > 0;
      const candidate: OrientationCandidate = {
        axis: null, degrees: 0, label: 'current',
        overhangRatio: 0.1, overhangFaces: 1, buildHeightMm: 10,
        baseContactAreaMm2: 100, trueContactAreaMm2: 90,
        baseContactOk: true, footprintMm2: 200, baseContactFraction: 0.5,
      };
      return {
        candidates: [candidate], chosen: candidate, rotatedGeometry: null,
        rotated: false, verdict: 'kept', reason: null, tallSlender: false,
      };
    });

    fireEvent.click(screen.getByText('CHECK ORIENTATION'));
    await act(async () => {
      await vi.waitFor(() => expect(suggestOrientation).toHaveBeenCalled());
    });

    // Without the rAF yield in check(), the synchronous call lands before
    // React commits setBusy — this assertion fails there.
    expect(busyShownWhenCalled).toBe(true);
    expect(await screen.findByText('Current orientation is already the best available.')).toBeTruthy();
  });
});
