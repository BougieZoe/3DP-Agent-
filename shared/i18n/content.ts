/**
 * Shared analysis-content i18n.
 *
 * The messages themselves live in ./catalog.ts (one catalogue for UI chrome and
 * analysis text). This module keeps the analysis-facing API: a keyed lookup with
 * {param} interpolation and the ContentDict type the pipeline imports.
 *
 * Terminology notes (3D printing):
 *   thin wall  → 薄壁 (zh) / 薄肉 (ja)
 *   overhang   → 悬垂 (zh) / オーバーハング (ja)
 *   support    → 支撑 (zh) / サポート (ja)
 *   slicer     → 切片软件 (zh) / スライサー (ja)
 *   warping    → 翘曲 (zh) / 反り (ja)
 *   delamination → 层间剥离 (zh) / 層間剥離 (ja)
 *   sagging    → 下垂/塌陷 (zh) / たわみ (ja)
 */
import { MESSAGES } from './catalog';

export type ContentLang = 'en' | 'ja' | 'zh';

/** Single source of truth for which languages the UI offers. */
export const SUPPORTED_LANGUAGES: readonly ContentLang[] = ['en', 'ja', 'zh'] as const;

/** Display names for the language selector (shown in the target language). */
export const LANGUAGE_NAMES: Record<ContentLang, string> = {
  en: 'English',
  ja: '日本語',
  zh: '简体中文',
};

export interface ContentEntry {
  en: string;
  ja: string;
  zh: string;
}

export type ContentDict = Record<string, ContentEntry>;

/**
 * Look up `key` for `lang` and substitute `{param}` placeholders.
 * Falls back to English, then to the key itself when missing.
 */
export function translate(
  dict: ContentDict,
  key: string,
  lang: ContentLang,
  params?: Record<string, string | number>,
): string {
  const entry = dict[key];
  if (!entry) return key;
  let text = entry[lang] ?? entry.en;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/**
 * The catalogue itself, exposed under the historical name so the pipeline and
 * every `translate(CONTENT, …)` call site keep working unchanged.
 */
export const CONTENT: ContentDict = MESSAGES as unknown as ContentDict;
