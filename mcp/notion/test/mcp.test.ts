import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { proofread } from '../dist/proofread.js';
import { buildQuoteText } from '../dist/quote.js';

describe('proofread', () => {
  it('fixes 印刷→造形 in JA AM context', () => {
    const r = proofread('印刷リスクが高い', 'ja');
    assert.ok(r.findings.some((f) => f.rule === 'ja-zoukei'));
    assert.ok(r.fixed.includes('造形リスク'));
  });
  it('catches fake zeros in all langs', () => {
    assert.ok(proofread('重量 0–0g', 'ja').fixed.includes('—'));
    assert.ok(proofread('weight 0–0g, $0.00', 'en').fixed.includes('—'));
    assert.ok(proofread('重量0–0g', 'zh').fixed.includes('—'));
  });
  it('passes clean text with no findings', () => {
    const r = proofread('造形リスクが高い (62/100)', 'ja');
    assert.equal(r.findings.length, 0);
  });
});

describe('quote', () => {
  it('builds a JA draft with blocked estimates', () => {
    const t = buildQuoteText({
      fileName: 'open-cube.stl', lang: 'ja', verdict: '要確認',
      score: 62, size: '1 × 1 × 1 mm', estimatesBlocked: true,
      cheapestStep: 'まずメッシュ修復',
    });
    assert.ok(t.includes('見積書（ドラフト）'));
    assert.ok(t.includes('算出不可'));
    assert.ok(t.includes('最安の次の一手'));
  });
});
