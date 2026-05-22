import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { executeLocalPrintReviewWorkflow } from '../printReviewWorkflow';

function createTriangleGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
    ]), 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]), 3),
  );
  return geometry;
}

function createClock() {
  const timestamps = [
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.010Z',
    '2026-01-01T00:00:00.020Z',
    '2026-01-01T00:00:00.030Z',
    '2026-01-01T00:00:00.040Z',
    '2026-01-01T00:00:00.050Z',
    '2026-01-01T00:00:00.060Z',
    '2026-01-01T00:00:00.070Z',
  ];
  return () => timestamps.shift() ?? '2026-01-01T00:00:00.080Z';
}

describe('executeLocalPrintReviewWorkflow', () => {
  it('runs deterministic print review stages sequentially', async () => {
    const result = await executeLocalPrintReviewWorkflow(
      new File(['ignored'], 'fixture.stl'),
      { language: 'en' },
      {
        now: createClock(),
        parseMesh: async () => createTriangleGeometry(),
      },
    );

    expect(result.stages.parseMesh.status).toBe('completed');
    expect(result.stages.analyzeGeometry.status).toBe('completed');
    expect(result.stages.evaluatePrintability.status).toBe('completed');
    expect(result.stages.generateReport.status).toBe('completed');
    expect(result.stages.parseMesh.durationMs).toBe(10);
    expect(result.stages.analyzeGeometry.output?.triangleCount).toBe(1);
    expect(result.stages.evaluatePrintability.output).toBeDefined();
    expect(result.report?.source).toBe('local_rules');
    expect(result.report?.content).toContain('VERDICT:');
  });

  it('can explicitly skip report generation without changing prior stages', async () => {
    const result = await executeLocalPrintReviewWorkflow(
      new File(['ignored'], 'fixture.stl'),
      { language: 'en', generateReport: false },
      {
        now: createClock(),
        parseMesh: async () => createTriangleGeometry(),
      },
    );

    expect(result.stages.parseMesh.status).toBe('completed');
    expect(result.stages.analyzeGeometry.status).toBe('completed');
    expect(result.stages.evaluatePrintability.status).toBe('completed');
    expect(result.stages.generateReport.status).toBe('skipped');
    expect(result.report).toBeUndefined();
  });

  it('marks the active stage failed and leaves later stages pending', async () => {
    const result = await executeLocalPrintReviewWorkflow(
      new File(['ignored'], 'broken.stl'),
      { language: 'en' },
      {
        now: createClock(),
        parseMesh: async () => {
          throw new Error('Parse failed');
        },
      },
    );

    expect(result.stages.parseMesh.status).toBe('failed');
    expect(result.stages.parseMesh.error?.message).toBe('Parse failed');
    expect(result.stages.analyzeGeometry.status).toBe('pending');
    expect(result.stages.evaluatePrintability.status).toBe('pending');
    expect(result.stages.generateReport.status).toBe('pending');
  });
});
