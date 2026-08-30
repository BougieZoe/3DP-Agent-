import { CausalityGraph } from './causalityEngine'
import { PatternMatch } from './topologyPatternEngine'
import { GeometrySuggestion } from './counterfactualEngine'
import { CausalityTimeline } from './CausalityTimeline'
import { PANEL } from '@/lib/visualLanguage'
import type { ContentLang } from '@shared/i18n/content'

function CausalityGraphView({
  graph,
  onSelectEvent,
  selectedId,
}: {
  graph: CausalityGraph | null
  onSelectEvent: (id: string | null) => void
  selectedId: string | null
}) {
  if (!graph) return null
  const nodes = graph.events
  const edges = graph.edges
  const W = 520, H = 180, pad = 20
  const xs = nodes.map(n => n.timestamp)
  const minT = Math.min(...xs), maxT = Math.max(...xs) || 1
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach(n => {
    const x = pad + ((n.timestamp - minT) / (maxT - minT || 1)) * (W - pad*2)
    const y = pad + (1 - n.severity) * (H - pad*2) * 0.8 + (n.severity*7)%10
    pos.set(n.id, { x, y })
  })
  return (
    <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40 overflow-hidden`}>
      <div className={`${PANEL.fontLabel} mb-2`}>Graph · 专家视图 · 点节点钻取</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px] bg-muted/5 rounded-sm border border-border/10">
        {edges.map((e, i) => {
          const a = pos.get(e.sourceId), b = pos.get(e.targetId)
          if (!a || !b) return null
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="hsl(var(--border))" strokeOpacity={0.4} strokeWidth={1} />
        })}
        {nodes.map(n => {
          const p = pos.get(n.id)!
          const isSel = selectedId === n.id
          const r = 4 + n.severity * 6
          return (
            <g key={n.id} onClick={() => onSelectEvent(isSel ? null : n.id)} style={{ cursor: 'pointer' }}>
              <circle cx={p.x} cy={p.y} r={r} fill={isSel ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'} fillOpacity={isSel ? 0.9 : 0.5} stroke="hsl(var(--background))" strokeWidth={1.5} />
              <text x={p.x} y={p.y + r + 10} textAnchor="middle" fontSize={7} fill="hsl(var(--muted-foreground))" fontFamily="monospace">{n.type.split('_')[0]}</text>
            </g>
          )
        })}
      </svg>
      <div className="text-[10px] font-mono text-muted-foreground/30 mt-1">点节点看因果 · 仅专家展开</div>
    </div>
  )
}

export function CausalityUnified(props: {
  graph: CausalityGraph | null
  patternMatches: PatternMatch[]
  suggestions: GeometrySuggestion[]
  selectedEventId: string | null
  onSelectEvent: (id: string | null) => void
  selectedSuggestionId: string | null
  onSelectSuggestion: (id: string | null) => void
  language?: ContentLang
  geometry?: any
  onPreview?: (s: GeometrySuggestion) => void
  onDownload?: (s: GeometrySuggestion) => void
}) {
  return (
    <div className="space-y-3">
      {/* 使用逻辑：1 个时间线默认 + 专家图谱折叠，不让用户选视图 */}
      <CausalityTimeline
        graph={props.graph}
        patternMatches={props.patternMatches}
        suggestions={props.suggestions}
        selectedEventId={props.selectedEventId}
        onSelectEvent={props.onSelectEvent}
        selectedSuggestionId={props.selectedSuggestionId}
        onSelectSuggestion={props.onSelectSuggestion}
        language={props.language}
      />
      <details className="group">
        <summary className="text-[10px] font-mono text-muted-foreground/30 cursor-pointer list-none flex items-center gap-1 hover:text-muted-foreground/60">
          <span className="group-open:rotate-90 transition-transform">›</span> 专家图谱（Obsidian）
        </summary>
        <div className="pt-2">
          <CausalityGraphView graph={props.graph} onSelectEvent={props.onSelectEvent} selectedId={props.selectedEventId} />
        </div>
      </details>
      {props.suggestions.length > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground/30">点时间线上事件展开，再点 Preview 在视口直接看修复（已用真实几何，非 dummy）</div>
      )}
    </div>
  )
}
