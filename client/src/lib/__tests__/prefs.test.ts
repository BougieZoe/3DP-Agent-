// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readPref, writePref } from '../prefs';

describe('prefs', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips an allowed value', () => {
    writePref('lang', 'ja');
    expect(readPref('lang', ['en', 'ja', 'zh'] as const, 'en')).toBe('ja');
  });

  it('falls back when the stored value is not allowed', () => {
    writePref('lang', 'klingon');
    expect(readPref('lang', ['en', 'ja', 'zh'] as const, 'en')).toBe('en');
  });

  it('falls back when nothing is stored', () => {
    expect(readPref('units', ['mm', 'cm', 'inch'] as const, 'mm')).toBe('mm');
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => writePref('lang', 'zh')).not.toThrow();
    expect(readPref('lang', ['en', 'ja', 'zh'] as const, 'en')).toBe('en');
  });

  it('namespaces keys so they cannot collide with other apps', () => {
    writePref('lang', 'zh');
    expect(localStorage.getItem('3dp.lang')).toBe('zh');
  });
});
