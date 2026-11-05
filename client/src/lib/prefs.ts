/**
 * Typed localStorage wrapper for UI preferences that must survive a reload.
 *
 * Why: language, material and source units are part of the *analysis setup*,
 * not per-session state. They were plain useState, so every refresh reset a
 * Japanese user to English and a PETG user to PLA — then silently re-ran the
 * analysis with the wrong assumptions.
 *
 * Never throws: private-mode Safari and quota errors must not break render.
 */
const PREFIX = '3dp.';

export function readPref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    /* storage unavailable — fall through */
  }
  return fallback;
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable or full — preferences simply won't persist */
  }
}
