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
 * The office is a static HTML page (/office.html) bundled with the app.
 * It loads office3d.js (Three.js 3D scene) and receives telemetry from this
 * page via postMessage. No external server required.
 */
const OFFICE_URL = '/office.html';

/**
 * Bridge the local TelemetryHub into the embedded office page.
 *
 * The office page receives agent status changes via postMessage and updates
 * the 3D scene accordingly. The office page answers with `office-ready` once
 * its scene is up; only then do we push, and we re-push a full snapshot so
 * an office page that mounted late still catches up.
 */
function useOfficeBridge(iframeRef: RefObject<HTMLIFrameElement | null>) {
  const readyRef = useRef(false);
  const lastRef = useRef<Record<string, string>>({});

  const push = useCallback(
    (agentId: string, status: string) => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      w.postMessage({ type: 'office-event', agent: agentId, status }, '*');
    },
    [iframeRef],
  );

  // Handshake: once the office page reports ready, flush a full snapshot.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
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

/**
 * Fullscreen overlay — the office fills the viewport; a slim top bar carries the
 * Live Floor identity and the exit affordance (ESC also closes).
 */
function OfficeOverlay({ t, onClose }: { t: T; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useOfficeBridge(iframeRef);

  const exitNow = useCallback(() => onClose(), [onClose]);

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
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <span className="font-mono text-[11px] tracking-[0.22em] text-foreground">
          {t('featuresOfficeTitle')}
        </span>
        <span className="hidden text-[11px] font-mono text-muted-foreground/60 sm:inline">
          {t('featuresOfficeSubtitle')}
        </span>
        <div className="ml-auto flex items-center gap-3">
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

      <iframe
        ref={iframeRef}
        src={OFFICE_URL}
        title={t('featuresOfficeTitle')}
        className="absolute inset-0 z-0 h-full w-full border-0"
        allow="fullscreen"
      />
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
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useOfficeBridge(iframeRef);

  return (
    <div className="group relative overflow-hidden rounded-sm border border-primary/30 bg-card">
      <div className="relative aspect-video w-full bg-background lg:aspect-auto lg:h-[calc(100dvh_-_24.3rem)] min-h-[240px]">
        <iframe
          ref={iframeRef}
          src={OFFICE_URL}
          title={t('featuresOfficeTitle')}
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 h-full w-full border-0"
          allow="fullscreen"
        />
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
