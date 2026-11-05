/**
 * 3DP Agent — UI string lookup.
 *
 * All strings (UI chrome AND analysis content) live in
 * @shared/i18n/catalog. This module is the typed UI-facing view over it:
 * a per-language flat map plus getTranslation() with {param} interpolation.
 *
 * `translations` is derived, not authored. Add strings to the catalogue.
 */
import { MESSAGES, type MessageKey } from '@shared/i18n/catalog';
import type { ContentLang } from '@shared/i18n/content';

/** Single shared language type — extensions (KO/DE/…) live in @shared/i18n/content. */
export type Language = ContentLang;

type Lang = 'en' | 'ja' | 'zh';
type Flat = { [K in MessageKey]: string };

const buildFlat = (lang: Lang): Flat => {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(MESSAGES)) out[key] = entry[lang];
  return out as Flat;
};

export const translations: Record<Lang, Flat> = {
  en: buildFlat('en'),
  ja: buildFlat('ja'),
  zh: buildFlat('zh'),
};

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
  let text = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}
