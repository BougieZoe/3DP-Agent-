import { describe, expect, it } from 'vitest';
import { parseDiagnosis, failureModeLabel, buildDiagnosisPrompt } from '../failureDiagnosis';

describe('parseDiagnosis', () => {
  it('parses a well-formed diagnosis', () => {
    const raw = JSON.stringify({
      overallAssessment: 'The print warped at the corners from uneven cooling.',
      failureModes: [
        { mode: 'warping', probability: 0.8, causes: ['uneven cooling'], fixes: ['use an enclosure'] },
      ],
      confidence: 0.75,
    });
    const d = parseDiagnosis(raw)!;
    expect(d.overallAssessment).toContain('warped');
    expect(d.failureModes).toHaveLength(1);
    expect(d.failureModes[0].mode).toBe('warping');
    expect(d.failureModes[0].probability).toBe(0.8);
    expect(d.failureModes[0].causes[0]).toBe('uneven cooling');
    expect(d.confidence).toBe(0.75);
  });

  it('tolerates markdown fences around the JSON', () => {
    const raw = '```json\n{"overallAssessment":"ok","failureModes":[{"mode":"stringing","probability":0.6,"causes":[],"fixes":[]}],"confidence":0.5}\n```';
    expect(parseDiagnosis(raw)!.failureModes[0].mode).toBe('stringing');
  });

  it('clamps probability/confidence to 0..1 and drops junk modes', () => {
    const raw = JSON.stringify({
      overallAssessment: 'n',
      failureModes: [
        { mode: 'warping', probability: 5, causes: ['a'], fixes: [] },
        'junk-string',
        { mode: '', probability: 0.2, causes: [], fixes: [] },
      ],
      confidence: -1,
    });
    const d = parseDiagnosis(raw)!;
    expect(d.failureModes).toHaveLength(1);       // junk dropped
    expect(d.failureModes[0].probability).toBe(1); // clamped from 5
    expect(d.confidence).toBe(0);                  // clamped from -1
  });

  it('returns null for non-JSON output or missing assessment', () => {
    expect(parseDiagnosis('not json')).toBeNull();
    expect(parseDiagnosis('{"failureModes":[]}')).toBeNull();
  });
});

describe('buildDiagnosisPrompt', () => {
  it('includes material context when provided', () => {
    expect(buildDiagnosisPrompt('PLA (FDM)')).toContain('PLA (FDM)');
    expect(buildDiagnosisPrompt()).not.toContain('The part was printed');
  });
});

describe('failureModeLabel', () => {
  it('localizes known modes and passes through unknown ones', () => {
    expect(failureModeLabel('warping', 'en')).toBe('Warping');
    expect(failureModeLabel('mystery_mode', 'en')).toBe('mystery_mode');
  });
});
