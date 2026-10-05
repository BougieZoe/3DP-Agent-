import { describe, it, expect } from 'vitest';
import { buildQuoteText } from '../handoffPack';
import {
  buildMockUnifiedAnalysis,
  normalMetrics,
  normalValidation,
} from '../../agents/__tests__/testAgentFixtures';

describe('buildQuoteText', () => {
  it('emits full estimates for a closed model', () => {
    const ua = buildMockUnifiedAnalysis({
      metrics: normalMetrics(),
      validation: normalValidation(),
    });
    const ja = buildQuoteText(ua, 'cube.stl', 'ja');
    expect(ja).toContain('見積書（ドラフト）');
    expect(ja).not.toContain('算出不可');
    const en = buildQuoteText(ua, 'cube.stl', 'en');
    expect(en).toContain('Quote (draft)');
    const zh = buildQuoteText(ua, 'cube.stl', 'zh');
    expect(zh).toContain('报价单（草稿）');
  });

  it('falls back to — with an unavailable note for an open shell', () => {
    const ua = buildMockUnifiedAnalysis({
      metrics: { ...normalMetrics(), meshVolumeMm3: 0, volumeReliable: false },
      validation: { ...normalValidation(), isWatertight: false, holeCount: 1 },
    });
    const ja = buildQuoteText(ua, 'open.stl', 'ja');
    expect(ja).toContain('—');
    expect(ja).toContain('算出不可');
    expect(ja).toContain('最安の次の一手');
    expect(ja).toContain('メッシュ修復');
    // Never prints fake zeros.
    expect(ja).not.toContain('0–0g');
    expect(ja).not.toContain('$0.00');
  });
});
