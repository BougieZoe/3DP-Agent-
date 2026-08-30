import { CONTENT, translate, type ContentLang } from '@shared/i18n/content'
import { CausalityGraph } from './causalityEngine'
import { PatternMatch } from './topologyPatternEngine'
import { GeometrySuggestion } from './counterfactualEngine'
import { PANEL, EVENT_COLORS_CSS } from '@/lib/visualLanguage'

export function CausalityMinimal({
  graph,
  patternMatches,
  suggestions,
  onSelectEvent,
  onPreview,
  onDownload,
  language = 'en',
}: {
  graph: CausalityGraph | null
  patternMatches: PatternMatch[]
  suggestions: GeometrySuggestion[]
  onSelectEvent: (id: string | null) => void
  onPreview?: (s: GeometrySuggestion) => void
  onDownload?: (s: GeometrySuggestion) => void
  language?: ContentLang
}) {
  if (!graph || graph.events.length === 0) {
    return <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-12`}>{translate(CONTENT, 'causality.noData', language)}</div>
  }

  // 聚合模式 1 行 1 动作
  const aggregated = (() => {
    const m = new Map<string, { name: string; total: number; id: string }>()
    for (const pm of patternMatches) {
      const cur = m.get(pm.pattern.id) ?? { name: pm.pattern.name, total: 0, id: pm.pattern.id }
      cur.total += pm.clusterPositions.length
      m.set(pm.pattern.id, cur)
    }
    return Array.from(m.values()).sort((a,b)=>b.total-a.total).slice(0,3)
  })()

  const best = suggestions[0]
  const sorted = [...graph.events].sort((a,b)=> b.severity - a.severity).slice(0,5)

  return (
    <div className="space-y-3">
      {/* 1 摘要 */}
      <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60 flex items-center gap-2`}>
        <span className="text-[11px] font-mono text-foreground">{graph.events.length} 事件</span>
        <span className="text-muted-foreground/20">→</span>
        <span className="text-[11px] font-mono text-muted-foreground">{aggregated.length} 模式</span>
        <span className="text-muted-foreground/20">→</span>
        {best ? <span className="text-[11px] font-mono text-cyan-400">1 个动作 -{best.riskReduction}%</span> : <span className="text-[11px] font-mono text-muted-foreground/40">暂无动作</span>}
      </div>

      {/* 1 图：迷你因果图 */}
      <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40`}>
        <div className={`${PANEL.fontLabel} mb-2`}>Causal Graph · 点节点看详情</div>
        <div className="flex flex-wrap gap-1.5">
          {sorted.map(ev => (
            <button
              key={ev.id}
              onClick={() => onSelectEvent(ev.id)}
              className={`text-[10px] font-mono px-2 py-1 rounded-full border transition-all ${EVENT_COLORS_CSS[ev.type]} hover:opacity-80`}
              title={ev.label}
            >
              {(ev.severity*100).toFixed(0)}% {ev.type.split('_')[0]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-muted-foreground/30">
          <span>→</span> <span>边标 11 条因果，点节点钻取</span>
        </div>
      </div>

      {/* 1 主按钮：每个模式 1 卡 1 动作 */}
      {aggregated.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          {aggregated.map(a => {
            const sug = suggestions.find(s => s.patternImpact.includes(a.name)) ?? best
            return (
              <div key={a.id} className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60 flex flex-col gap-2`}>
                <div className="w-full h-16 rounded-sm bg-muted/10 border border-border/10 flex items-center justify-center overflow-hidden">
                  <span className="text-[9px] font-mono text-muted-foreground/30">mini 3D ×{a.total}</span>
                </div>
                <div className="text-[11px] font-mono text-foreground truncate">{a.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground/60">影响 {a.total} 处</div>
                {sug && (
                  <div className="flex gap-1 mt-auto">
                    {onPreview && <button onClick={() => onPreview(sug)} className="flex-1 text-[10px] font-mono py-1.5 rounded-sm border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10">Preview</button>}
                    {onDownload && <button onClick={() => onDownload(sug)} className="flex-1 text-[10px] font-mono py-1.5 rounded-sm bg-cyan-400 text-black hover:bg-cyan-300">Fix</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40 text-[11px] font-mono text-muted-foreground/40 text-center`}>暂无模式 · 模型较完美</div>
      )}
    </div>
  )
}
