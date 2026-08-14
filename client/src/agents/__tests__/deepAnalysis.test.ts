import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildModelDataSummary,
  scoreFromParsed,
  verdictForScore,
  mapStepToResult,
  runDeepAnalysis,
} from '../deepAnalysis';
import type { ModelData } from '@/lib/ruleEngine';
import { DEFAULT_MATERIAL } from '@/lib/materialState';
import { runAgentPipeline, type AgentStepResult } from '@/lib/agentPipeline';

const sampleModel: ModelData = {
  fileName: 'test-bracket.stl',
  wallThickness: {
    minThickness: 0.8,
    p1Thickness: 0.9,
    p5Thickness: 1.1,
    p10Thickness: 1.4,
    medianThickness: 2.0,
    avgThickness: 2.1,
    thinWallCount: 12,
    thinWallPercentage: 8,
    thinWallRatio: 0.08,
    averageConfidence: 0.72,
    areas: 120,
    status: 'warning',
  },
  overhang: { angle: 55, areas: 480, status: 'critical' },
  volume: 42_000,
  surfaceArea: 12_500,
  dims: { x: 80, y: 40, z: 25 },
};

function fakeStep(over: Partial<AgentStepResult> = {}): AgentStepResult {
  return {
    agentName: 'fake',
    raw: '{"ok":true}',
    parsed: { ok: true },
    confidence: 'high',
    ...over,
  };
}

describe('buildModelDataSummary', () => {
  it('includes every key geometry fact the pipeline needs', () => {
    const s = buildModelDataSummary(sampleModel, DEFAULT_MATERIAL);
    expect(s).toContain('test-bracket.stl');
    expect(s).toContain('80.0 × 40.0 × 25.0');
    expect(s).toContain('42000');
    expect(s).toContain('12500');
    expect(s).toContain('min=0.80 mm');
    expect(s).toContain('p5=1.10 mm');
    expect(s).toContain('thinWallCount=12');
    expect(s).toContain('thinWallRatio=0.080');
    expect(s).toContain('status=warning');
    expect(s).toContain('facesBeyondThreshold=480');
    expect(s).toContain('status=critical');
  });

  it('handles unknown wall thickness gracefully', () => {
    const model = { ...sampleModel, wallThickness: { ...sampleModel.wallThickness, minThickness: null, p5Thickness: null } };
    const s = buildModelDataSummary(model, DEFAULT_MATERIAL);
    expect(s).toContain('min=unknown');
    expect(s).toContain('p5=unknown');
  });
});

describe('scoreFromParsed', () => {
  it('reads numeric printability_score', () => {
    expect(scoreFromParsed({ printability_score: 87 })).toBe(87);
  });
  it('reads string and clamps to 0–100', () => {
    expect(scoreFromParsed({ printability_score: '112' })).toBe(100);
    expect(scoreFromParsed({ printability_score: '-5' })).toBe(0);
  });
  it('returns null for missing/invalid/NaN values', () => {
    expect(scoreFromParsed({})).toBeNull();
    expect(scoreFromParsed({ printability_score: 'abc' })).toBeNull();
    expect(scoreFromParsed({ printability_score: NaN })).toBeNull();
    expect(scoreFromParsed(null)).toBeNull();
    expect(scoreFromParsed('nope')).toBeNull();
  });
});

describe('verdictForScore', () => {
  it('maps thresholds to pass/warning/fail', () => {
    expect(verdictForScore(70)).toBe('pass');
    expect(verdictForScore(69)).toBe('warning');
    expect(verdictForScore(40)).toBe('warning');
    expect(verdictForScore(39)).toBe('fail');
  });
});

describe('mapStepToResult', () => {
  it('projects an LLM step onto the AgentRunSummary shape', () => {
    const step = fakeStep({ parsed: { printability_score: 78, defects: ['thin wall'] } });
    const r = mapStepToResult(step, 'printability_scorer', 'en');
    expect(r.agentId).toBe('printability_scorer');
    expect(r.score).toBe(78);
    expect(r.verdict).toBe('pass');
    expect(r.confidence).toBe(0.85);
    expect(r.markers).toEqual([]);
    expect(r.details).toEqual({ printability_score: 78, defects: ['thin wall'] });
  });

  it('defaults to score 50 when the step has no parseable score', () => {
    const step = fakeStep({ parsed: null, confidence: 'low_after_retries' });
    const r = mapStepToResult(step, 'geometry_analyst', 'en');
    expect(r.score).toBe(50);
    expect(r.verdict).toBe('warning');
    expect(r.confidence).toBe(0.45);
    expect(r.details).toEqual({ raw: step.raw });
  });

  it('keeps unverified LLM steps at medium confidence', () => {
    const r = mapStepToResult(fakeStep({ confidence: undefined }), 'failure_predictor', 'en');
    expect(r.confidence).toBe(0.6);
  });
});

describe('runDeepAnalysis gating', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null (no LLM path) when no provider key is configured', async () => {
    const result = await runDeepAnalysis(sampleModel, 'en', undefined, DEFAULT_MATERIAL);
    expect(result).toBeNull();
  });
});

describe('deep analysis abort handling', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('3dp_agent_api_keys', JSON.stringify({ deepseek: 'sk-test' }));
    localStorage.setItem('3dp_agent_active_provider', 'deepseek');
  });

  it('threads the caller signal into the in-flight fetch of the pipeline', async () => {
    const originalFetch = globalThis.fetch;
    const capturedSignals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      capturedSignals.push(init?.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as typeof fetch;
    try {
      const controller = new AbortController();
      const pipelinePromise = runAgentPipeline('model summary', 'en', undefined, DEFAULT_MATERIAL, controller.signal);

      await new Promise(r => setTimeout(r, 5));
      expect(capturedSignals.length).toBeGreaterThan(0);
      expect(capturedSignals[0]).toBe(controller.signal);

      controller.abort();
      await expect(pipelinePromise).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts a hung deep analysis at the timeout and returns null', async () => {
    const originalFetch = globalThis.fetch;
    let aborted = false;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as typeof fetch;
    vi.useFakeTimers();
    try {
      const resultPromise = runDeepAnalysis(sampleModel, 'en');
      await vi.advanceTimersByTimeAsync(100_000);
      await expect(resultPromise).resolves.toBeNull();
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
    }
  });
});
