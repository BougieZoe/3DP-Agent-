import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import type { translations } from '@/lib/i18n';
import type { DynamicParam } from '@/lib/cadParams';

type TKey = keyof (typeof translations)['en'];

interface DynamicParamsPanelProps {
  params: DynamicParam[];
  values: Record<string, string>;
  sectionsOpen: Record<string, boolean>;
  onToggleSection: (section: string) => void;
  onChange: (name: string, value: string) => void;
  onStep: (name: string, delta: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  t: (key: TKey) => string;
}

const SECTION_ORDER = ['dimensions', 'holes', 'details', 'manufacturing'];

const SECTION_TKEY: Record<string, TKey> = {
  dimensions: 'cadSectionDimensions',
  holes: 'cadSectionHoles',
  details: 'cadSectionDetails',
  manufacturing: 'cadSectionManufacturing',
};

/**
 * Edits the parameters extracted from the current model's build123d source
 * (see cadParams.ts). Sliders are grouped by section and drive a debounced
 * regeneration. Undo/redo map to the CADWorkspace parameter history.
 */
export function DynamicParamsPanel({
  params,
  values,
  sectionsOpen,
  onToggleSection,
  onChange,
  onStep,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  t,
}: DynamicParamsPanelProps) {
  const bySection = useMemo(() => {
    const map: Record<string, DynamicParam[]> = {};
    for (const p of params) (map[p.section] ??= []).push(p);
    return map;
  }, [params]);

  return (
    <div className="flex flex-col h-full bg-card font-mono">
      {/* Header + undo/redo */}
      <div className="px-4 py-3 border-b border-border/15 flex items-center justify-between">
        <div className="text-[10px] tracking-[0.3em] text-muted-foreground/50 uppercase">
          {t('cadParametricControl')}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onUndo} disabled={!canUndo} title={t('cadUndo')}
            className="w-7 h-7 inline-flex items-center justify-center border border-border/40 rounded-sm text-muted-foreground/60 hover:text-foreground hover:border-foreground/30 disabled:opacity-30 disabled:pointer-events-none transition-all">
            <Undo2 className="w-3 h-3" />
          </button>
          <button onClick={onRedo} disabled={!canRedo} title={t('cadRedo')}
            className="w-7 h-7 inline-flex items-center justify-center border border-border/40 rounded-sm text-muted-foreground/60 hover:text-foreground hover:border-foreground/30 disabled:opacity-30 disabled:pointer-events-none transition-all">
            <Redo2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {SECTION_ORDER.filter(s => bySection[s]?.length).map(section => {
          const open = sectionsOpen[section] !== false;
          return (
            <div key={section} className="space-y-2">
              <button onClick={() => onToggleSection(section)}
                className="w-full flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {t(SECTION_TKEY[section])}
              </button>
              {open && (
                <div className="space-y-3">
                  {bySection[section].map(p => {
                    const raw = values[p.name];
                    const num = parseFloat(raw) || 0;
                    const pct = p.max > p.min ? Math.max(0, Math.min(100, ((num - p.min) / (p.max - p.min)) * 100)) : 0;
                    return (
                      <div key={p.name} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground/70">{p.label}</span>
                          <span className="text-[13px] font-bold text-muted-foreground tabular-nums">
                            {raw}
                            {p.unit && (
                              <span className="text-[10px] font-normal text-muted-foreground/50 ml-0.5">{p.unit}</span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => onStep(p.name, -p.step)}
                            className="w-5 h-5 shrink-0 inline-flex items-center justify-center border border-border/40 rounded-sm text-muted-foreground/60 hover:text-foreground hover:border-foreground/30 transition-all">
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="range"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={num}
                            onChange={e => onChange(p.name, e.target.value)}
                            className="flex-1 h-[3px] appearance-none bg-muted rounded-full cursor-pointer accent-primary outline-none"
                            style={{
                              background: `linear-gradient(to right, var(--color-primary) ${pct}%, var(--color-muted) ${pct}%)`,
                            }}
                          />
                          <button onClick={() => onStep(p.name, p.step)}
                            className="w-5 h-5 shrink-0 inline-flex items-center justify-center border border-border/40 rounded-sm text-muted-foreground/60 hover:text-foreground hover:border-foreground/30 transition-all">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
