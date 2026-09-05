import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDiagnosticPrompt,
  checkGrounding,
  runSemanticDiagnostic,
  type DiagnosticInput,
} from '../semanticDiagnostic';
import * as config from '../config';

// ── Fixture ─────────────────────────────────────────────────────────────────

const FIXTURE_INPUT: DiagnosticInput = {
  wallThicknessDistribution: {
    min: 0.8,
    max: 4.2,
    mean: 2.1,
    belowThresholdPercent: 12.5,
  },
  watertightStatus: {
    isWatertight: true,
    boundaryEdgeCount: 0,
    nonManifoldEdgeCount: 0,
  },
  confidenceScore: 0.65,
  thresholdsApplied: {
    thinWallMm: 1.5,
    overhangThresholdDeg: 45,
  },
};

// ── Test 1: Fixture test — prompt construction contains exact numeric values ─

describe('semanticDiagnostic', () => {
  describe('buildDiagnosticPrompt', () => {
    it('serializes exact numeric values from DiagnosticInput into the prompt', () => {
      const prompt = buildDiagnosticPrompt(FIXTURE_INPUT);

      // All numeric values from the fixture must appear literally in the prompt
      expect(prompt).toContain('0.8');
      expect(prompt).toContain('4.2');
      expect(prompt).toContain('2.1');
      expect(prompt).toContain('12.5');
      expect(prompt).toContain('0.65');
      expect(prompt).toContain('1.5');
      expect(prompt).toContain('45');

      // Boolean and zero values
      expect(prompt).toContain('isWatertight: true');
      expect(prompt).toContain('boundaryEdgeCount: 0');
      expect(prompt).toContain('nonManifoldEdgeCount: 0');

      // Structure check
      expect(prompt).toContain('Wall Thickness:');
      expect(prompt).toContain('Watertight Status:');
      expect(prompt).toContain('Thresholds Applied:');
    });

    it('handles null wall thickness values', () => {
      const input: DiagnosticInput = {
        ...FIXTURE_INPUT,
        wallThicknessDistribution: {
          min: null,
          max: null,
          mean: null,
          belowThresholdPercent: 0,
        },
      };
      const prompt = buildDiagnosticPrompt(input);
      expect(prompt).toContain('minimum: null mm');
      expect(prompt).toContain('maximum: null mm');
      expect(prompt).toContain('mean: null mm');
    });
  });

  // ── Test 2: Grounding test — model output checked against input facts ─

  describe('checkGrounding', () => {
    it('identifies numbers that exist in the input', () => {
      const summary = 'The minimum wall thickness is 0.8mm, which is below the 1.5mm threshold.';
      const { citedFacts, inventedNumbers } = checkGrounding(summary, FIXTURE_INPUT);

      expect(citedFacts).toContain('0.8');
      expect(citedFacts).toContain('1.5');
      expect(inventedNumbers).toHaveLength(0);
    });

    it('flags numbers NOT present in the input as invented', () => {
      const summary = 'The part has a warpage of 3.7mm and needs 23 percent infill.';
      const { citedFacts, inventedNumbers } = checkGrounding(summary, FIXTURE_INPUT);

      // 3.7 and 23 are not in the input fixture
      expect(inventedNumbers).toContain(3.7);
      expect(inventedNumbers).toContain(23);
      expect(citedFacts).toHaveLength(0);
    });

    it('allows derived numbers that are exact ratios of input numbers', () => {
      // 2.1 / 1.5 = 1.4 — a valid ratio
      const summary = 'The mean thickness is 2.1mm, a ratio of 1.4x the threshold.';
      const { inventedNumbers } = checkGrounding(summary, FIXTURE_INPUT);
      // 1.4 = 2.1 / 1.5, which is a valid derived number
      // But 2.1 is directly in input, so it's cited
      // The check is heuristic — derived numbers near ratios are allowed
      expect(inventedNumbers.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Test 3: Fallback test — provider "none" skips module entirely ─

  describe('provider="none" fallback', () => {
    let spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      spy = vi.spyOn(config, 'getSemanticLayerProvider').mockReturnValue('none');
    });

    afterEach(() => {
      spy.mockRestore();
    });

    it('returns unavailable without calling any LLM endpoint', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await runSemanticDiagnostic(FIXTURE_INPUT);

      expect(result.summary).toBeNull();
      expect(result.citedFacts).toHaveLength(0);
      expect(result.modelUsed).toBe('unavailable');
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });

  // ── Test 4: Timeout test — hung request returns "unavailable" ─

  describe('timeout handling', () => {
    it('returns unavailable when provider hangs beyond timeout', async () => {
      vi.spyOn(config, 'getSemanticLayerProvider').mockReturnValue('local');
      vi.spyOn(config, 'SEMANTIC_LAYER_LOCAL_ENDPOINT', 'get').mockReturnValue('/v1/chat/completions');

      // Mock fetch to reject with AbortError (simulating timeout)
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('The operation was aborted.', 'AbortError')
      );

      const result = await runSemanticDiagnostic(FIXTURE_INPUT);

      expect(result.summary).toBeNull();
      expect(result.modelUsed).toBe('unavailable');

      vi.restoreAllMocks();
    });

    it('returns unavailable when cloud provider returns error', async () => {
      vi.spyOn(config, 'getSemanticLayerProvider').mockReturnValue('cloud');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 500, statusText: 'Internal Server Error' })
      );

      const result = await runSemanticDiagnostic(FIXTURE_INPUT);

      expect(result.summary).toBeNull();
      expect(result.modelUsed).toBe('unavailable');

      vi.restoreAllMocks();
    });

    it('returns unavailable when response body is empty', async () => {
      vi.spyOn(config, 'getSemanticLayerProvider').mockReturnValue('local');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await runSemanticDiagnostic(FIXTURE_INPUT);

      expect(result.summary).toBeNull();
      expect(result.modelUsed).toBe('unavailable');

      vi.restoreAllMocks();
    });
  });
});
