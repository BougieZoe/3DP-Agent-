import { useState } from 'react'
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content'
import { CausalityGraph } from './causalityEngine'
import { PatternMatch } from './topologyPatternEngine'
import { GeometrySuggestion } from './counterfactualEngine'
import { PANEL, EVENT_COLORS_CSS } from '@/lib/visualLanguage'

const TYPE_ICONS: Record<string, string> = {
  thermal_accumulation: '⧗',
  cooling_imbalance: '↓↑',
  support_instability: '⊥',
  bridge_oscillation: '∿',
  wall_vibration: '∼',
  overhang_sag: '↓',
  delamination_risk: '═',
  failure_spike: '⚠',
}

export function CausalityTimeline({
  graph,
  patternMatches,
  suggestions,
  selectedEventId,
  onSelectEvent,
  selectedSuggestionId,
  onSelectSuggestion,
  onPreview,
  onDownload,
  recalcMap,
  downloadingId,
  language = 'en',
}: {
  graph: CausalityGraph | null
  patternMatches: PatternMatch[]
  suggestions: GeometrySuggestion[]
  selectedEventId: string | null
  onSelectEvent: (id: string | null) => void
  selectedSuggestionId: string | null
  onSelectSuggestion: (id: string | null) => void
  onPreview?: (s: GeometrySuggestion) => void
  onDownload?: (s: GeometrySuggestion) => void
  recalcMap?: Map<string, any>
  downloadingId?: string | null
  language?: ContentLang
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  if (!graph || graph.events.length === 0) {
    return (
      <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-12`}>
        {translate(CONTENT, 'causality.noData', language)}
      </div>
    )
  }

  const sorted = [...graph.events].sort((a, b) => a.timestamp - b.timestamp)
  const rootCount = graph.events.filter(e => graph.edges.every(ed => ed.targetId !== e.id)).length
  const best = suggestions[0]

  // 聚合：全图只显示一次每个模式，7 行不再重复
  const aggregated = (() => {
    const m = new Map<string, { name: string; total: number }>()
    for (const pm of patternMatches) {
      const cur = m.get(pm.pattern.id) ?? { name: pm.pattern.name, total: 0 }
      cur.total += pm.clusterPositions.length
      m.set(pm.pattern.id, cur)
    }
    return Array.from(m.values()).sort((a,b)=>b.total-a.total)
  })()

  return (
    <div className="space-y-3">
      {/* 摘要条 — Apple 健康式 */}
      <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60 flex items-center gap-3`}>
        <span className="text-[11px] font-mono text-foreground">{rootCount} 根因</span>
        <span className="text-muted-foreground/20">·</span>
        <span className="text-[11px] font-mono text-muted-foreground">{aggregated.length} 模式</span>
        <span className="text-muted-foreground/20">·</span>
        {best ? (
          <span className="text-[11px] font-mono text-cyan-400">最优修复 -{best.riskReduction}%</span>
        ) : (
          <span className="text-[11px] font-mono text-muted-foreground/40">暂无建议</span>
        )}
        <span className="ml-auto text-[10px] font-mono text-muted-foreground/30">{graph.events.length} 事件</span>
      </div>

      {/* 聚合模式 — 鼠标沿着落下来逐个高亮 */}
      {aggregated.length > 0 && (
        <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40`}>
          <div className={`${PANEL.fontLabel} mb-1.5`}>Patterns · 悬停高亮</div>
          <div className="flex flex-wrap gap-1.5">
            {aggregated.map(a => {
              const isHovered = hovered === a.name
              return (
                <span
                  key={a.name}
                  onMouseEnter={() => setHovered(a.name)}
                  onMouseLeave={() => setHovered(null)}
                  className={`${PANEL.chip} text-[10px] px-1.5 py-0.5 border rounded-sm cursor-pointer transition-all duration-200 ease-out transform-gpu ${
                    isHovered
                      ? 'bg-cyan-400 text-black border-cyan-400 scale-[1.08] -translate-y-1 shadow-lg shadow-cyan-400/20 z-10 rotate-[0.5deg]'
                      : 'bg-cyan-400/5 border-cyan-400/20 text-cyan-400/80 hover:bg-cyan-400/10 hover:border-cyan-400/40 hover:text-cyan-400 hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-md'
                  }`}
                >
                  {a.name} ×{a.total}
                </span>
              )
            })}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/30 mt-1">鼠标沿着标签滑过逐个高亮 · 对应 3D 同步</div>
        </div>
      )}

      {/* 时间线 */}
      <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40 border-l-2`}>
        <div className="space-y-1">
          {sorted.map((ev, i) => {
            const isExpanded = expanded === ev.id
            const isSelected = selectedEventId === ev.id
            // 去重：同一模式在同一事件只算一次，否则 7 行都显示 Thermal Trap Cavity×2
            const seen = new Set<string>()
            const relatedPatterns = patternMatches.filter(pm => {
              if (seen.has(pm.pattern.id)) return false
              const hit = pm.clusterPositions.some(cp => ev.positions.some((p:any) => Math.abs(cp.x-p.x)<0.5 && Math.abs(cp.y-p.y)<0.5))
              if (hit) seen.add(pm.pattern.id)
              return hit
            })
            const relatedSugs = suggestions.filter(s => s.affectedPositions.some(ap => ev.positions.some((p:any) => Math.abs(ap.x-p.x)<0.5)))
            const colorClass = EVENT_COLORS_CSS[ev.type]?.split(' ')[0] ?? 'text-muted-foreground'
            return (
              <div key={ev.id}>
                {i > 0 && <div className="flex justify-center py-0.5"><span className="text-[10px] text-muted-foreground/15">↓</span></div>}
                <button
                  onClick={() => { setExpanded(isExpanded ? null : ev.id); onSelectEvent(isSelected ? null : ev.id) }}
                  onMouseEnter={() => setHovered(ev.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={`w-full text-left ${PANEL.paddingCard} ${PANEL.roundedInner} border transition-all duration-200 ease-out transform-gpu flex items-center gap-2 ${
                    isSelected
                      ? `${PANEL.selectedBorder} ${PANEL.selectedBg} shadow-sm`
                      : hovered === ev.id
                        ? 'border-cyan-400/40 bg-cyan-400/10 shadow-lg shadow-cyan-400/15 scale-[1.01] -translate-y-0.5 z-10 rotate-[0.3deg]'
                        : isExpanded
                          ? 'border-border/60 bg-foreground/[0.02]'
                          : 'border-transparent hover:border-cyan-400/30 hover:bg-cyan-400/[0.04] hover:shadow-md hover:scale-[1.005] hover:-translate-y-px'
                  }`}
                >
                  <span className={`text-xs ${colorClass}`}>{TYPE_ICONS[ev.type] ?? '●'}</span>
                  <span className={`${PANEL.fontSmall} ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>{ev.label}</span>
                  <span className={`ml-auto ${PANEL.fontValue} ${colorClass}`}>{(ev.severity*100).toFixed(0)}%</span>
                  <span className="text-[10px] text-muted-foreground/30">{isExpanded ? '−' : '+'}</span>
                </button>
                {isExpanded && (
                  <div className="ml-4 mt-1 pl-3 border-l border-border/10 space-y-1.5">
                    <div className={`${PANEL.fontTiny} text-muted-foreground/30`}>{ev.description}</div>
                    {relatedSugs.slice(0,2).map(s => {
                      const recalc = recalcMap?.get(s.id)
                      return (
                        <div key={s.id} className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-2 bg-background/60`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px]">{s.label}</span>
                            <span className="ml-auto text-[10px] font-mono text-muted-foreground/40">{s.confidence}%</span>
                          </div>
                          {recalc && (
                            <div className="text-[10px] font-mono mt-1 text-emerald-400">{recalc.beforeThin}→{recalc.afterThin} · {recalc.riskBefore}%→{recalc.riskAfter}%</div>
                          )}
                          <div className="flex gap-1 mt-1.5">
                            {onPreview && !recalc && <button onClick={() => onPreview(s)} className="flex-1 text-[10px] font-mono py-1 rounded-sm border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10">Preview</button>}
                            {onDownload && <button onClick={() => onDownload(s)} className="flex-1 text-[10px] font-mono py-1 rounded-sm border border-cyan-400/40 text-cyan-400 hover:bg-cyan-400 hover:text-black bg-cyan-400/5">{downloadingId===s.id?'...':'Download'}</button>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
