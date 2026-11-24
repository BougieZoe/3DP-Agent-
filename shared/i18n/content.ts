/**
 * Shared analysis-content i18n.
 *
 * The messages themselves live in ./catalog.ts (one catalogue for UI chrome and
 * analysis text). This module keeps the analysis-facing API: a keyed lookup with
 * {param} interpolation and the ContentDict type the pipeline imports.
 *
 * Language coverage policy
 * ------------------------
 * `en` is the authoring language and is complete by definition. `ja` and `zh`
 * are complete too. The remaining languages (ko/de/es/fr/it/sv) are filled per
 * key: a key that has no translated string yet resolves through `FALLBACK_LANG`
 * instead of rendering the raw key, so a half-translated language degrades to
 * readable English rather than leaking `pdf.changeReportTitle` into the UI.
 * `catalog.test.ts` enforces that the *UI-chrome* keys are translated in every
 * shipped language and lets the long-form analysis copy fall back meanwhile.
 *
 * Nordic: shipped as Swedish (`sv`). Norwegian/Danish/Finnish occupy the same
 * slot — adding one is a language-list entry plus catalogue strings, no code.
 *
 * Terminology notes (3D printing):
 *   thin wall  → 薄壁 (zh) / 薄肉 (ja)
 *   overhang   → 悬垂 (zh) / オーバーハング (ja)
 *   support    → 支撑 (zh) / サポート (ja)
 *   slicer     → 切片软件 (zh) / スライサー (ja)
 *   warping    → 翘曲 (zh) / 反り (ja)
 *   delamination → 层间剥离 (zh) / 層間剥離 (ja)
 *   sagging    → 下垂/塌陷 (zh) / たわみ (ja)
 *   yield      → 良率 (zh) / 歩留まり (ja) / 수율 (ko) / Ausbeute (de)
 */
import { MESSAGES } from './catalog';

/** Every language the app can be switched to. */
export type ContentLang = 'en' | 'ja' | 'zh' | 'ko' | 'de' | 'es' | 'fr' | 'it' | 'sv';

/** Single source of truth for which languages the UI offers (selector order). */
export const SUPPORTED_LANGUAGES: readonly ContentLang[] = [
  'en', 'zh', 'ja', 'ko', 'de', 'es', 'fr', 'it', 'sv',
] as const;

/** The language a missing string falls back to. */
export const FALLBACK_LANG: ContentLang = 'en';

/** Display names, each written in its own language (language pickers convention). */
export const LANGUAGE_NAMES: Record<ContentLang, string> = {
  en: 'English',
  zh: '简体中文',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  sv: 'Svenska',
};

/** Short tag for compact selectors and badges. */
export const LANGUAGE_TAGS: Record<ContentLang, string> = {
  en: 'EN',
  zh: '中文',
  ja: 'JA',
  ko: 'KO',
  de: 'DE',
  es: 'ES',
  fr: 'FR',
  it: 'IT',
  sv: 'SV',
};

/**
 * A small inline label table keyed by language: `en` is mandatory, every other
 * language may be absent and resolves to English.
 *
 * Components that keep their own handful of labels use this (plus `pickLang`)
 * so that adding a language to the app never yields `undefined` for tables that
 * have not been translated yet.
 */
export type PartialLangDict<T> = { en: T } & Partial<Record<ContentLang, T>>;

/**
 * Pick the best available value from a per-language label table.
 *
 * Deliberately tolerant: only `en` must exist and it defines the shape, so a
 * partially translated inline table (some languages missing a field) still
 * resolves instead of breaking the build.
 */
export function pickLang<T extends { en: unknown }>(dict: T, lang: ContentLang): T['en'] {
  const table = dict as unknown as Record<string, T['en'] | undefined>;
  return table[lang] ?? dict.en;
}

export interface ContentEntry {
  en: string;
  ja: string;
  zh: string;
  // Translated progressively; absent means "fall back to English for now".
  ko?: string;
  de?: string;
  es?: string;
  fr?: string;
  it?: string;
  sv?: string;
}

export type ContentDict = Record<string, ContentEntry>;

/** Narrow an arbitrary string (URL param, stored pref) to a shipped language. */
export function isContentLang(value: unknown): value is ContentLang {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Resolve one entry to display text: the language's own string when present,
 * otherwise English, otherwise undefined (caller decides what to show).
 */
export function entryText(entry: ContentEntry | undefined, lang: ContentLang): string | undefined {
  if (!entry) return undefined;
  return entry[lang] ?? entry[FALLBACK_LANG];
}

/** Languages that still lack a real string for `key` (used by the coverage test). */
export function missingLangs(key: string, dict: ContentDict = CONTENT): ContentLang[] {
  const entry = dict[key];
  if (!entry) return [...SUPPORTED_LANGUAGES];
  return SUPPORTED_LANGUAGES.filter((lang) => {
    if (lang === FALLBACK_LANG) return false;
    const value = entry[lang];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

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
  let text = entry[lang] ?? entry[FALLBACK_LANG] ?? key;
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
