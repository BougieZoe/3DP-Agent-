import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2 } from 'lucide-react';
import type { translations } from '@/lib/i18n';

type TKey = keyof (typeof translations)['en'];
type T = (key: TKey) => string;

/**
 * Live Floor — the entry point into the agents' 3D office (real-time monitoring).
 *
 * The office itself is served by the local console service (~/3dp-agent,
 * web_console.py) on port 8091 as a bare full-viewport page at `/office`, so it
 * can be embedded directly as an iframe. This component only renders the entry
 * banner + the fullscreen overlay; it never touches the 3D scene itself.
 *
 * Override the service origin with VITE_OFFICE_URL when the console runs
 * somewhere other than the default local port.
 */
const OFFICE_ORIGIN = (
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_OFFICE_URL as
    | string
    | undefined) || 'http://127.0.0.1:8091'
).replace(/\/+$/, '');
const OFFICE_URL = `${OFFICE_ORIGIN}/office`;
const OFFICE_HEALTH_URL = `${OFFICE_ORIGIN}/health`;

type Status = 'checking' | 'online' | 'offline';

/** Opaque probe: any HTTP response means the service is listening. */
async function probeOffice(timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(OFFICE_HEALTH_URL, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
    </span>
  );
}

/**
 * Fullscreen overlay — the office fills the viewport; a slim top bar carries the
 * Live Floor identity and the exit affordance (ESC also closes).
 */
function OfficeOverlay({ t, onClose }: { t: T; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('checking');
  const [attempt, setAttempt] = useState(0);

  /**
   * Close on pointerdown (not only click). The office iframe is a separate
   * browsing context: the first press after it takes focus can be spent on
   * restoring focus to the parent document, so a click-only handler needs a
   * second press. pointerdown fires before that hand-off, so the very first
   * press on the exit affordance always closes. `onClose` is idempotent, so
   * keeping the click handler as well (keyboard / assistive tech) is safe.
   */
  const exitNow = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    let alive = true;
    setStatus('checking');
    probeOffice().then((ok) => {
      if (alive) setStatus(ok ? 'online' : 'offline');
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-background">
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-border/40 bg-background/85 px-4 py-2.5 backdrop-blur-sm">
        <LiveDot />
        <span className="font-mono text-[11px] tracking-[0.22em] text-foreground">
          {t('featuresOfficeTitle')}
        </span>
        <span className="hidden text-[11px] font-mono text-muted-foreground/60 sm:inline">
          {t('featuresOfficeSubtitle')}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {status === 'online' && (
            <span className="text-[10px] font-mono tracking-widest text-emerald-400">
              {t('officeStatusLive')}
            </span>
          )}
          <button
            type="button"
            onPointerDown={exitNow}
            onClick={exitNow}
            aria-label={t('officeExit')}
            className="select-none rounded-sm border border-border px-3 py-1.5 text-[10px] font-mono text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            {t('officeExit')}
          </button>
        </div>
      </div>

      {status === 'online' ? (
        <iframe
          key={attempt}
          src={OFFICE_URL}
          title={t('featuresOfficeTitle')}
          className="absolute inset-0 z-0 h-full w-full border-0"
          allow="fullscreen"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-sm border border-border bg-card grid-bg p-6 text-center">
            <div className="font-mono text-[11px] tracking-widest text-muted-foreground">
              {status === 'checking' ? t('officeStatusChecking') : t('officeOfflineTitle')}
            </div>
            {status === 'offline' && (
              <>
                <div className="mt-3 text-xs leading-relaxed text-muted-foreground/70">
                  {t('officeOfflineDesc')}
                </div>
                <code className="mt-4 block rounded-sm border border-border/60 bg-background/60 px-3 py-2 text-left text-[11px] font-mono text-cyan-400">
                  python3 web_console.py
                </code>
                <div className="mt-1 text-left text-[10px] font-mono text-muted-foreground/40">
                  {OFFICE_ORIGIN}/office
                </div>
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    onClick={() => setAttempt((n) => n + 1)}
                    className="rounded-sm border border-primary/50 px-4 py-1.5 text-[11px] font-mono text-primary transition-colors hover:bg-primary hover:text-background"
                  >
                    {t('officeRetry')}
                  </button>
                  <button
                    type="button"
                    onPointerDown={exitNow}
                    onClick={exitNow}
                    className="select-none rounded-sm border border-border px-4 py-1.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {t('officeExit')}
                  </button>
                </div>
              </>
            )}
            {status === 'checking' && (
              <div className="mt-3 text-xs font-mono text-primary animate-pulse">▋</div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * The banner. `variant="hero"` is the page-level full-width strip rendered
 * outside the home two-column split (so it spans the whole page and stays in
 * the first screen); `variant="inline"` is the compact version used inside the
 * AGENTS tab.
 */
function OfficeBanner({
  t,
  variant,
  onOpen,
}: {
  t: T;
  variant: 'hero' | 'inline';
  onOpen: () => void;
}) {
  if (variant === 'inline') {
    return (
      <button
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-sm border border-primary/30 bg-card grid-bg px-3.5 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-foreground/5"
      >
        <LiveDot />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs tracking-[0.22em] text-foreground">
              {t('featuresOfficeTitle')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {t('featuresOfficeSubtitle')}
            </span>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-sm border border-primary/40 px-2.5 py-1 text-[10px] font-mono text-primary">
          <Maximize2 className="h-3 w-3" />
          {t('officeFullscreen')}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={onOpen}
      className="group relative flex w-full items-center gap-4 overflow-hidden rounded-sm border border-primary/40 bg-card grid-bg px-4 py-4 text-left transition-colors hover:border-primary/70"
    >
      <span className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary/40" />
      <LiveDot />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-sm tracking-[0.22em] text-foreground">
            {t('featuresOfficeTitle')}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground/70">
            {t('featuresOfficeSubtitle')}
          </span>
        </div>
        <div className="mt-1 text-xs leading-snug text-muted-foreground/70">
          {t('featuresOfficeDesc')}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/5 px-3 py-1.5 text-[10px] font-mono text-primary transition-colors group-hover:bg-primary group-hover:text-background">
        <Maximize2 className="h-3 w-3" />
        {t('officeFullscreen')}
      </span>
    </button>
  );
}

/**
 * Live Floor entry: banner + fullscreen office overlay.
 * `variant="hero"` renders as a page-level full-width banner (mount it above
 * the home two-column split); `variant="inline"` is the AGENTS-tab entry.
 */
export function AgentOfficeEntry({
  t,
  variant = 'hero',
}: {
  t: T;
  variant?: 'hero' | 'inline';
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <OfficeBanner t={t} variant={variant} onOpen={() => setOpen(true)} />
      {open && <OfficeOverlay t={t} onClose={close} />}
    </>
  );
}
