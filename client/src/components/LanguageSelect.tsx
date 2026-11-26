/**
 * LanguageSelect — compact language picker.
 *
 * Collapsed state shows the short tag only (EN / JP / ZH / KO / DE / ES / FR /
 * IT / SV) so the header row stays narrow; the expanded list spells each
 * language out in its own script. Selection is a pure `onChange` hand-off, so
 * the caller keeps owning `language` state and its persisted preference.
 */
import { useEffect, useRef, useState } from 'react';
import { LANGUAGE_NAMES, LANGUAGE_TAGS, SUPPORTED_LANGUAGES } from '@shared/i18n/content';
import type { Language } from '@/lib/i18n';

interface LanguageSelectProps {
  language: Language;
  onChange: (language: Language) => void;
  /** Tighter metrics for the mobile header row. */
  compact?: boolean;
  title?: string;
}

export function LanguageSelect({ language, onChange, compact = false, title = 'Language' }: LanguageSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const collapsedClass = compact
    ? 'text-[11px] font-mono px-1.5 py-1 border border-border rounded-sm bg-background text-muted-foreground'
    : 'text-xs font-mono px-2 py-1 border border-border rounded-sm bg-background text-muted-foreground';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={`${title} · ${LANGUAGE_NAMES[language]}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${title}: ${LANGUAGE_NAMES[language]}`}
        className={`${collapsedClass} inline-flex cursor-pointer items-center gap-1 leading-none transition-colors ${
          open ? 'border-primary/50 text-primary' : 'hover:text-primary'
        }`}
      >
        <span className="tracking-wider">{LANGUAGE_TAGS[language]}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={title}
          className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-sm border border-border bg-background py-1 shadow-xl"
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = lang === language;
            return (
              <button
                key={lang}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(lang);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs font-mono transition-colors ${
                  active ? 'text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-primary'
                }`}
              >
                <span>{LANGUAGE_NAMES[lang]}</span>
                {active && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
