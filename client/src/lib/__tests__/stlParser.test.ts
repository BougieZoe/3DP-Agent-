import { describe, expect, it } from 'vitest';
import { isASCIISTL } from '../stlParser';

function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('stlParser', () => {
  it('preserves current ASCII STL detection semantics', () => {
    expect(isASCIISTL(textBuffer('solid model'))).toBe(true);
    expect(isASCIISTL(textBuffer('SOLID model'))).toBe(false);
    expect(isASCIISTL(textBuffer('binary data'))).toBe(false);
  });
});
