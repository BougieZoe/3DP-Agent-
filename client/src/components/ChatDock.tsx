/**
 * ChatDock — floating chat launcher.
 *
 * Uploads live in the page's own STL drop zone, so this dock deliberately owns
 * no upload surface of its own: it is a launcher plus a camera entry that opens
 * the photo → CAD reconstruction flow in place (the panel switches views, it
 * does not nest a card inside a card).
 */
import { useCallback, useState } from 'react';
import { getTranslation, type Language } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import { PhotoToCadPanel } from '@/components/PhotoToCadPanel';

interface ChatDockProps {
  language: Language;
  initiallyCollapsed?: boolean;
}

type DockView = 'chat' | 'photo';

declare global {
  interface Window {
    desktopChatFloat?: { open: (origin: string) => Promise<void> | void };
  }
}

const tr = (language: Language, key: string, fallback: string): string => {
  const value = getTranslation(language, key as TranslationKey);
  return value && value !== key ? value : fallback;
};

export function ChatDock({ language, initiallyCollapsed = true }: ChatDockProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [floatOpen, setFloatOpen] = useState(false);
  const [view, setView] = useState<DockView>('chat');

  const openDetached = useCallback(async () => {
    const bridge = window.desktopChatFloat;
    if (bridge) {
      await bridge.open(window.location.origin);
      setFloatOpen(true);
      return;
    }
    window.open(`${window.location.origin}/?chatFloat=1`, 'chat-float', 'width=440,height=640');
    setFloatOpen(true);
  }, []);

  const photoLabel = tr(language, 'photoToCad', 'Photo → CAD');

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title={tr(language, 'chatAI', 'Chat')}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-neutral-900/90 px-4 py-3 text-xs font-semibold text-white shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:bg-neutral-800"
      >
        {tr(language, 'chatAI', 'Chat').toUpperCase()}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-white/10 bg-neutral-950/95 p-3 text-xs text-neutral-200 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold tracking-wide">
          {tr(language, 'chatAI', 'Chat').toUpperCase()}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openDetached}
            disabled={floatOpen}
            className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-neutral-100 disabled:opacity-40"
            title="Open in a separate window"
          >
            Float
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-neutral-100"
            title="Collapse"
          >
            —
          </button>
        </div>
      </div>

      {/* Icon rail: the only live entry is the camera tab (photo → CAD). */}
      <div
        role="tablist"
        aria-label={photoLabel}
        className="mb-3 flex items-center gap-1 border-b border-white/10 pb-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === 'photo'}
          aria-label={photoLabel}
          title={view === 'photo' ? `${photoLabel} · close` : photoLabel}
          onClick={() => setView(view === 'photo' ? 'chat' : 'photo')}
          className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors ${
            view === 'photo'
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-white/10 text-neutral-400 hover:border-primary/40 hover:text-primary'
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          <span>{photoLabel}</span>
        </button>
      </div>

      {view === 'photo' && (
        <div className="max-h-[60vh] overflow-y-auto pr-0.5">
          <PhotoToCadPanel language={language} embedded />
        </div>
      )}
    </div>
  );
}

export default ChatDock;
