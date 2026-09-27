import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2 } from 'lucide-react';
import { getTelemetryHub } from '@/agents/core';
import type { translations } from '@/lib/i18n';

type TKey = keyof (typeof translations)['en'];
type T = (key: TKey) => string;

/**
 * Live Floor — the entry point into the agents' 3D office (real-time monitoring).
 *
 * The office itself is served by the local console service (~/3dp-agent,
 * web_console.py, default http://127.0.0.1:8091) as a bare full-viewport page
 * at `/office`, so it can be embedded directly as an iframe. This component
 * only renders the entry banner + the fullscreen overlay; it never touches the
 * 3D scene itself.
 *
 * Override the service origin with VITE_OFFICE_URL when the console runs
 * somewhere other than the default local port.
 */
const OFFICE_ORIGIN = (
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_OFFICE_URL as
    | string
    | undefined)
  || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:8091`
    : '')  // deployed without VITE_OFFICE_URL → office unavailable
).replace(/\/+$/, '');
const OFFICE_URL = `${OFFICE_ORIGIN}/office`;
const OFFICE_HEALTH_URL = `${OFFICE_ORIGIN}/health`;
/**
 * Preview URL: `hud=0` hides the in-page view/lighting HUD. The preview iframe
 * is pointer-inert by design (it must not swallow the click that opens the
 * fullscreen overlay), so leaving the HUD visible would advertise buttons the
 * user can never press. The fullscreen overlay keeps the HUD.
 */
const OFFICE_PREVIEW_URL = `${OFFICE_URL}?hud=0`;

/**
 * Bridge the local TelemetryHub into the embedded office page.
 *
 * The office (`/office` on the console service) drives its own scene from the
 * console's SSE stream, which only knows about runs started *there*. When the
 * office is embedded in this site, the analysis runs in this page instead, so
 * its telemetry must be pushed across the iframe boundary with postMessage:
 * one `office-event` per agent status change, posted to OFFICE_ORIGIN. The
 * office page answers with `office-ready` once its scene is up; only then do we
 * push, and we re-push a full snapshot at that point so an office page that
 * mounted late still catches up. Updates are deduplicated by status so the
 * iframe is never woken up twice for the same value.
 */
function useOfficeBridge(iframeRef: RefObject<HTMLIFrameElement | null>) {
  const readyRef = useRef(false);
  const lastRef = useRef<Record<string, string>>({});

  const push = useCallback(
    (agentId: string, status: string) => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      w.postMessage({ type: 'office-event', agent: agentId, status }, OFFICE_ORIGIN);
    },
    [iframeRef],
  );

  // Handshake: once the office page reports ready, flush a full snapshot.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== OFFICE_ORIGIN) return;
      if ((e.data as { type?: string })?.type !== 'office-ready') return;
      readyRef.current = true;
      for (const a of getTelemetryHub().getAll()) push(a.agentId, a.status);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [push]);

  // Subscribe to telemetry; only status *changes* cross the frame boundary.
  useEffect(() => {
    return getTelemetryHub().subscribe((all) => {
      if (!readyRef.current) return;
      for (const a of all) {
        if (lastRef.current[a.agentId] === a.status) continue;
        lastRef.current[a.agentId] = a.status;
        push(a.agentId, a.status);
      }
    });
  }, [push]);
}

type Status = 'checking' | 'online' | 'offline';

/** Opaque probe: any HTTP response means the service is listening. */
async function probeOffice(timeoutMs = 2500): Promise<boolean> {
  if (!OFFICE_ORIGIN) return false;
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useOfficeBridge(iframeRef);

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
          ref={iframeRef}
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
                  {OFFICE_ORIGIN
                    ? t('officeOfflineDesc')
                    : 'Office requires the local console service. Set VITE_OFFICE_URL or run locally.'}
                </div>
                {OFFICE_ORIGIN && (
                  <>
                    <code className="mt-4 block rounded-sm border border-border/60 bg-background/60 px-3 py-2 text-left text-[11px] font-mono text-cyan-400">
                      python3 web_console.py
                    </code>
                    <div className="mt-1 text-left text-[10px] font-mono text-muted-foreground/40">
                      {OFFICE_ORIGIN}/office
                    </div>
                  </>
                )}
                <div className="mt-5 flex justify-center gap-2">
                  {OFFICE_ORIGIN && (
                    <button
                      onClick={() => setAttempt((n) => n + 1)}
                      className="rounded-sm border border-primary/50 px-4 py-1.5 text-[11px] font-mono text-primary transition-colors hover:bg-primary hover:text-background"
                    >
                      {t('officeRetry')}
                    </button>
                  )}
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
 * The banner — the page-level full-width strip rendered outside the home
 * two-column split, so it spans the whole page and stays in the first screen.
 */
function OfficeBanner({ t, onOpen }: { t: T; onOpen: () => void }) {
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
 * Small-screen live view of the office, used inside the AGENTS panel where the
 * full scene is too heavy to host. The frame embeds the same office page and
 * hands the click off to the fullscreen overlay; the embedded iframe stays
 * pointer-inert so it can neither swallow that click nor steal focus.
 */
function OfficeLivePreview({ t, onOpen }: { t: T; onOpen: () => void }) {
  const [status, setStatus] = useState<Status>('checking');
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useOfficeBridge(iframeRef);

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

  return (
    <div className="group relative overflow-hidden rounded-sm border border-primary/30 bg-card">
      {/* No frame header here: the embedded office page already carries the
          "Live Floor · Agent Office" identity in its own HUD, so a header in
          this card would print the same label twice. The live frame fills the
          card instead, and the fullscreen affordance lives on the frame. */}
      <div className="relative aspect-video w-full bg-background lg:aspect-auto lg:h-[calc(100dvh_-_24.3rem)] min-h-[240px]">
        {status === 'online' ? (
          <>
            <iframe
              key={attempt}
              ref={iframeRef}
              src={OFFICE_PREVIEW_URL}
              title={t('featuresOfficeTitle')}
              tabIndex={-1}
              className="pointer-events-none absolute inset-0 h-full w-full border-0"
              allow="fullscreen"
            />
            {/* Click shield — the embedded page never owns the pointer here. */}
            <button
              type="button"
              onClick={onOpen}
              aria-label={t('officeFullscreen')}
              className="absolute inset-0 z-10 flex cursor-zoom-in items-end justify-end p-2"
            >
              <span className="flex items-center gap-1.5 rounded-sm border border-primary/40 bg-background/80 px-2 py-0.5 font-mono text-[9px] text-primary opacity-70 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <Maximize2 className="h-2.5 w-2.5" />
                {t('officeFullscreen')}
              </span>
            </button>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {status === 'checking' ? t('officeStatusChecking') : t('officeOfflineTitle')}
            </div>
            {status === 'offline' && (
              <>
                {!OFFICE_ORIGIN ? (
                  <div className="text-[10px] text-muted-foreground/70">
                    Office requires the local console service.
                  </div>
                ) : (
                  <>
                    <code className="rounded-sm border border-border/60 bg-background/60 px-2.5 py-1 font-mono text-[10px] text-cyan-400">
                      python3 web_console.py
                    </code>
                    <div className="text-[10px] font-mono text-muted-foreground/40">
                      {OFFICE_ORIGIN}/office
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttempt((n) => n + 1)}
                      className="rounded-sm border border-primary/50 px-3 py-1 font-mono text-[10px] text-primary transition-colors hover:bg-primary hover:text-background"
                    >
                      {t('officeRetry')}
                    </button>
                  </>
                )}
              </>
            )}
            {status === 'checking' && (
              <div className="font-mono text-[10px] text-primary animate-pulse">▋</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Live Floor entry: banner (or panel-sized live view) + fullscreen overlay.
 * `variant="hero"` is the banner for the home feature list; `variant="live"`
 * is the small-screen live office view for the AGENTS panel.
 */
export function AgentOfficeEntry({
  t,
  variant = 'hero',
}: {
  t: T;
  variant?: 'hero' | 'live';
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {variant === 'live' ? (
        <OfficeLivePreview t={t} onOpen={() => setOpen(true)} />
      ) : (
        <OfficeBanner t={t} onOpen={() => setOpen(true)} />
      )}
      {open && <OfficeOverlay t={t} onClose={close} />}
    </>
  );
}
