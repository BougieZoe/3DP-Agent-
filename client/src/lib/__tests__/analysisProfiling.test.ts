import { describe, it, expect, vi } from 'vitest';
import type { GeometryModel } from '@/analysis/geometryModel';

const mocks = vi.hoisted(() => ({
  runAnalysisInWorker: vi.fn(),
  captureTelemetry: vi.fn(),
}));

vi.mock('@/analysis', () => ({ runAnalysisInWorker: mocks.runAnalysisInWorker }));
vi.mock('../telemetry', () => ({ captureTelemetry: mocks.captureTelemetry }));

import { analyzeWithTelemetry } from '../analysisProfiling';

describe('analyzeWithTelemetry', () => {
  it('enables profiling and records exactly one telemetry event', async () => {
    const profiling = { buildGeometryGraph: 2, metrics: 7 };
    mocks.runAnalysisInWorker.mockResolvedValue({
      topology: { result: { triangleCount: 1234 } },
      profiling,
    } as never);
    const model = { triangleCount: 1234 } as GeometryModel;

    await analyzeWithTelemetry(model, { fileName: 'part.stl' });

    expect(mocks.runAnalysisInWorker).toHaveBeenCalledTimes(1);
    expect(mocks.runAnalysisInWorker).toHaveBeenCalledWith(
      model,
      expect.objectContaining({ fileName: 'part.stl', enableProfiling: true }),
    );
    expect(mocks.captureTelemetry).toHaveBeenCalledWith(1234, profiling);
  });
});
