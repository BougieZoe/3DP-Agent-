import { describe, it, expect } from 'vitest';
import { isWallConfidenceTrusted, MIN_TRUSTED_WALL_CONFIDENCE } from '../lowConfidence';

describe('low-confidence banner gate', () => {
  it('trusts the healthy-solid baseline of 0.4 exactly', () => {
    expect(MIN_TRUSTED_WALL_CONFIDENCE).toBe(0.4);
    expect(isWallConfidenceTrusted(0.4)).toBe(true);
    expect(isWallConfidenceTrusted(0.5)).toBe(true);
    expect(isWallConfidenceTrusted(1.0)).toBe(true);
  });

  it('flags every value below 0.4', () => {
    expect(isWallConfidenceTrusted(0.39)).toBe(false);
    expect(isWallConfidenceTrusted(0.3)).toBe(false);
    expect(isWallConfidenceTrusted(0.2)).toBe(false);
    expect(isWallConfidenceTrusted(0.0)).toBe(false);
  });
});
