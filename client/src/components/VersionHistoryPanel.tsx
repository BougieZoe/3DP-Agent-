import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { PANEL } from '@/lib/visualLanguage';
import type { ModelVersion, VersionAction } from '@/lib/modelVersions';
import { diffSnapshots } from '@/lib/modelVersions';

/**
 * Version history for the active model.
 *
 * A corrective action used to overwrite the previous state in place: the user
 * could not tell whether "repair" actually improved anything, and a reload
 * erased the record. Each row is a measured snapshot plus the action that
 * produced it, with the delta against the row below it.
 *
 * Metrics only — geometry is never stored (a 400k-triangle mesh does not
 * belong in localStorage).
 */

interface Props {
  versions: ModelVersion[];
  onClear: () => void;
  onExportPdf?: () => void;
  language: ContentLang;
}

const ACTION_KEY: Record<VersionAction, string> = {
  upload: 'history.action.upload',
  orientation: 'history.action.orientation',
  repair: 'history.action.repair',
  units: 'history.action.units',
};

function signed(n: number, digits = 2): string {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}

function Delta({ value, goodWhenPositive, unit = '' }: { value: number; goodWhenPositive: boolean; unit?: string }) {
  if (!Number.isFinite(value) || value === 0) return null;
  const good = goodWhenPositive ? value > 0 : value < 0;
  return (
    <span className={`ml-1 tabular-nums ${good ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
      {signed(value)}
      {unit}
    </span>
  );
}

export function VersionHistoryPanel({ versions, onClear, onExportPdf, language }: Props) {
  if (versions.length === 0) return null;

  const timeFmt = new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : 'en-GB', {
    hour: '2-digit', minute: '2-digit',
  });

  // Newest first. A discarded attempt is not a state the model was ever in,
  // so deltas are measured against the last *applied* row before it.
  let lastApplied: ModelVersion | null = null;
  const rows = versions
    .map((v) => {
      const prev = lastApplied;
      if (v.outcome !== 'discarded') lastApplied = v;
      return { v, prev };
    })
    .reverse();

  return (
    <section className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`${PANEL.fontLabel} text-muted-foreground/50`}>
          {translate(CONTENT, 'history.title', language)} · {versions.length}
        </span>
        <span className="flex items-center gap-2">
          {onExportPdf && versions.length > 1 && (
            <button
              type="button"
              onClick={onExportPdf}
              className="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors"
            >
              {translate(CONTENT, 'pdf.exportChanges', language)}
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-mono text-muted-foreground/35 hover:text-red-400/80 transition-colors"
          >
            {translate(CONTENT, 'history.clear', language)}
          </button>
        </span>
      </div>

      <ol className="space-y-1.5">
        {rows.map(({ v, prev }, idx) => {
          const discarded = v.outcome === 'discarded';
          const d = prev && !discarded ? diffSnapshots(prev.snapshot, v.snapshot) : null;
          const n = versions.length - idx; // v1 = first, newest = highest
          return (
            <li
              key={v.id}
              className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] font-mono leading-relaxed ${discarded ? 'opacity-45' : ''}`}
              title={v.note}
            >
              <span className="w-6 shrink-0 text-muted-foreground/30 tabular-nums">v{n}</span>
              <span className={`shrink-0 ${discarded ? 'text-muted-foreground/60 line-through' : 'text-foreground/70'}`}>
                {translate(CONTENT, ACTION_KEY[v.action], language)}
              </span>
              {discarded && (
                <span className="shrink-0 rounded-sm border border-red-400/25 px-1 text-[9px] text-red-400/50">
                  {translate(CONTENT, 'history.discarded', language)}
                </span>
              )}
              <span className="shrink-0 text-muted-foreground/30 tabular-nums">{timeFmt.format(v.at)}</span>

              <span className="min-w-0 text-muted-foreground/55">
                {translate(CONTENT, 'history.wall', language)}{' '}
                <span className="tabular-nums">{v.snapshot.minWallMm != null ? v.snapshot.minWallMm.toFixed(2) : '—'}mm</span>
                {d?.minWallMm != null && <Delta value={d.minWallMm} goodWhenPositive />}
              </span>

              <span className="min-w-0 text-muted-foreground/55">
                {translate(CONTENT, 'history.overhang', language)}{' '}
                <span className="tabular-nums">{v.snapshot.overhangFaces.toLocaleString('en-US')}</span>
                {d && d.overhangFaces !== 0 && <Delta value={d.overhangFaces} goodWhenPositive={false} />}
              </span>

              <span className={`ml-auto shrink-0 ${v.snapshot.isWatertight ? 'text-emerald-400/60' : 'text-red-400/50'}`}>
                {translate(CONTENT, v.snapshot.isWatertight ? 'history.sealed' : 'history.open', language)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
