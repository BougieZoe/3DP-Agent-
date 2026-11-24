/**
 * 3DP Agent — UI string lookup.
 *
 * All strings (UI chrome AND analysis content) live in
 * @shared/i18n/catalog. This module is the typed UI-facing view over it:
 * a per-language flat map plus getTranslation() with {param} interpolation.
 *
 * `translations` is derived, not authored. Add strings to the catalogue.
 *
 * Coverage: en/ja/zh are complete. ko/de/es/fr/it/sv resolve through
 * FALLBACK_LANG when a key has not been translated yet, so switching to a newer
 * language never renders a raw key.
 */
import { MESSAGES, type MessageKey } from '@shared/i18n/catalog';
import {
  FALLBACK_LANG,
  SUPPORTED_LANGUAGES,
  entryText,
  type ContentLang,
} from '@shared/i18n/content';

/** Single shared language type — extensions live in @shared/i18n/content. */
export type Language = ContentLang;

type Flat = { [K in MessageKey]: string };

const buildFlat = (lang: Language): Flat => {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(MESSAGES)) {
    out[key] = entryText(entry, lang) ?? key;
  }
  return out as Flat;
};

export const translations: Record<Language, Flat> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((lang) => [lang, buildFlat(lang)]),
) as Record<Language, Flat>;

/** Every message key, for callers that need to enumerate or forward one. */
export type TranslationKey = MessageKey;

/**
 * Look up a message, substituting {param} placeholders.
 * Falls back to English, then to the key itself (so a missing string is
 * visible in the UI instead of rendering "undefined").
 */
export function getTranslation(
  lang: Language,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text = translations[lang]?.[key] ?? translations[FALLBACK_LANG][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/**
 * True when `lang` carries a real string for `key` (no fallback in play).
 * Used by the coverage test and by UI that wants to flag untranslated spots.
 */
export function hasTranslation(lang: Language, key: TranslationKey): boolean {
  const entry = MESSAGES[key] as Record<string, string | undefined> | undefined;
  const value = entry?.[lang];
  return typeof value === 'string' && value.trim().length > 0;
}
