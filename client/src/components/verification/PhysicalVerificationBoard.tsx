import { useMemo, useState } from 'react'
import { PANEL, EVENT_COLORS_CSS } from '@/lib/visualLanguage'
import { translate, type ContentLang } from '@shared/i18n/content'

// 本地 i18n - 保证切换语言时 100% 同步
const VERIF: Record<string, { en: string; ja: string; zh: string }> = {
  'verif.precisionRecall': { en: 'Precision / Recall', ja: '適合率 / 再現率', zh: '精确率 / 召回率' },
  'verif.verified': { en: 'Verified / Accuracy', ja: '検証数 / 精度', zh: '验证数 / 准确率' },
  'verif.saved': { en: 'Total Saved / Avg', ja: '累計削減 / 平均', zh: '累计节省 / 平均' },
  'verif.timeSaved': { en: 'Time Saved', ja: '削減時間', zh: '节省时间' },
  'verif.materialTime': { en: 'material + time', ja: '材料 + 時間', zh: '材料 + 工时' },
  'verif.avoided': { en: 'failed reprints avoided', ja: '失敗再造形の回避', zh: '失败重打避免' },
  'verif.eventsConfusion': { en: '8-Event Confusion · Predicted vs Photo', ja: '8イベント混同行列 · 予測 vs 実写', zh: '8 事件混淆 · 预测 vs 实拍' },
  'verif.photoPending': { en: 'PHOTO\npending', ja: '写真\n未登録', zh: '照片\n待接入' },
  'verif.predicted': { en: 'Predicted:', ja: '予測:', zh: '预测：' },
  'verif.photo': { en: 'Photo:', ja: '実写:', zh: '实拍：' },
  'verif.noRisk': { en: 'no risk', ja: 'リスクなし', zh: '无风险' },
  'verif.noFailure': { en: 'no failure', ja: '失敗なし', zh: '无失效' },
  'verif.sampleCompare': { en: 'Sample Compare · Predicted vs Photo', ja: 'サンプル比較 · 予測 vs 実写', zh: '抽样对比 · 预测 vs 实拍' },
  'verif.hint': { en: 'Connect real data: 1) upload photo to S3, 2) QC labels actual, 3) board recalculates automatically. Currently mock 50 rows.', ja: '実データ連携: 1) 写真をS3へ, 2) 検品が actual を付与, 3) 自動再計算。現在はモック50件。', zh: '接入真实数据：1) 拍照上传到 S3，2) 质检标注 actual，3) 看板自动重算。当前为 Mock 50 条演示。' },
  'verif.hint2': { en: 'To make it accurate: replace photoUrl with S3 photo and actual with QC label. Mock is simulated, not real.', ja: '正確にするには photoUrl を実写真に、actual を検品結果に置換。モックは模擬データです。', zh: '要变准：把 photoUrl 换成实拍，actual 换成质检标注。Mock 是模拟假数据。' },
  'verif.all': { en: 'ALL', ja: 'すべて', zh: '全部' },
  'verif.events8': { en: '8 events × 50 prints', ja: '8イベント × 50造形', zh: '8 事件 × 50 打印' },
}
const t = (k: string, lang: ContentLang) => translate(VERIF as any, k, lang)

// 8 事件类型来自 causalityEngine.ts
const EVENT_TYPES = [
  'thermal_accumulation',
  'cooling_imbalance',
  'support_instability',
  'bridge_oscillation',
  'wall_vibration',
  'overhang_sag',
  'delamination_risk',
  'failure_spike',
] as const

type VerifRow = {
  id: string
  fileName: string
  predicted: typeof EVENT_TYPES[number][]
  actual: typeof EVENT_TYPES[number][]
  photoUrl: string
  material: string
  costSaved: number // 元
  timeSaved: number // 分钟
}

// Mock 50 打印对照 - 结构为真实拍照接入预留
function genMockRows(n = 50): VerifRow[] {
  const mats = ['PLA', 'PETG', 'ABS', 'TPU']
  const rows: VerifRow[] = []
  for (let i = 0; i < n; i++) {
    const pred = EVENT_TYPES.filter(() => Math.random() > 0.75).slice(0, 3)
    // 80% 准确率模拟：actual 与 pred 80% 重合
    const actual = pred.map(e => Math.random() > 0.2 ? e : EVENT_TYPES[Math.floor(Math.random()*8)] as any)
    if (Math.random() > 0.6 && actual.length === 0) actual.push(EVENT_TYPES[Math.floor(Math.random()*8)] as any)
    rows.push({
      id: `print-${i+1}`,
      fileName: `model_${String(i+1).padStart(3,'0')}.stl`,
      predicted: pred,
      actual,
      photoUrl: '', // 真实接入时填 S3 拍照 URL
      material: mats[i % 4],
      costSaved: pred.length > 0 && actual.length > 0 ? Math.round((10 + Math.random()*40)*10)/10 : 0,
      timeSaved: pred.length > 0 ? Math.round(15 + Math.random()*60) : 0,
    })
  }
  return rows
}

function calcMetrics(rows: VerifRow[]) {
  const byType: Record<string, { tp: number; fp: number; fn: number }> = {}
  for (const t of EVENT_TYPES) byType[t] = { tp: 0, fp: 0, fn: 0 }
  let tp=0, fp=0, fn=0
  for (const r of rows) {
    for (const t of EVENT_TYPES) {
      const p = r.predicted.includes(t), a = r.actual.includes(t)
      if (p && a) { byType[t].tp++; tp++ }
      else if (p && !a) { byType[t].fp++; fp++ }
      else if (!p && a) { byType[t].fn++; fn++ }
    }
  }
  const precision = tp+fp ? tp/(tp+fp) : 0
  const recall = tp+fn ? tp/(tp+fn) : 0
  const f1 = precision+recall ? 2*precision*recall/(precision+recall) : 0
  return { byType, tp, fp, fn, precision, recall, f1 }
}

export function PhysicalVerificationBoard({ language = 'en' as ContentLang }: { language?: ContentLang }) {
  const [rows] = useState(() => genMockRows(50))
  const [filter, setFilter] = useState<string>('all')
  const metrics = useMemo(() => calcMetrics(rows), [rows])
  const filtered = filter === 'all' ? rows : rows.filter(r => r.predicted.includes(filter as any) || r.actual.includes(filter as any))
  const totalSaved = rows.reduce((s,r)=>s+r.costSaved,0)
  const totalTime = rows.reduce((s,r)=>s+r.timeSaved,0)
  const avgSaved = totalSaved/rows.length

  return (
    <div className="space-y-4">
      {/* 顶部 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/60`}>{t('verif.precisionRecall', language)}</div>
          <div className="text-lg font-mono">{(metrics.precision*100).toFixed(1)}% / {(metrics.recall*100).toFixed(1)}%</div>
          <div className="text-[10px] font-mono text-muted-foreground/40">F1 {(metrics.f1*100).toFixed(1)}% · TP {metrics.tp} FP {metrics.fp} FN {metrics.fn}</div>
        </div>
        <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/60`}>{t('verif.verified', language)}</div>
          <div className="text-lg font-mono">{rows.length} / {(metrics.precision*100).toFixed(0)}%</div>
          <div className="text-[10px] font-mono text-muted-foreground/40">{t('verif.events8', language)}</div>
        </div>
        <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/60`}>{t('verif.saved', language)}</div>
          <div className="text-lg font-mono text-emerald-400">¥{totalSaved.toFixed(1)} / ¥{avgSaved.toFixed(1)}</div>
          <div className="text-[10px] font-mono text-muted-foreground/40">{t('verif.materialTime', language)}</div>
        </div>
        <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/60`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/60`}>{t('verif.timeSaved', language)}</div>
          <div className="text-lg font-mono">{Math.floor(totalTime/60)}h {totalTime%60}m</div>
          <div className="text-[10px] font-mono text-muted-foreground/40">{t('verif.avoided', language)}</div>
        </div>
      </div>

      {/* 按事件过滤 */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={()=>setFilter('all')} className={`text-xs font-mono px-2 py-1 border rounded-sm ${filter==='all'?'border-primary text-primary bg-primary/5':'border-border text-muted-foreground'}`}>{t('verif.all', language)} ({rows.length})</button>
        {EVENT_TYPES.map(t=>(
          <button key={t} onClick={()=>setFilter(t)} className={`text-xs font-mono px-2 py-1 border rounded-sm ${filter===t?'border-primary text-primary bg-primary/5':'border-border/60 text-muted-foreground/70'} ${EVENT_COLORS_CSS[t]?.split(' ')[0]}`}>{t} ({rows.filter(r=>r.predicted.includes(t)||r.actual.includes(t)).length})</button>
        ))}
      </div>

      {/* 8 事件混淆矩阵 */}
      <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40`}>
        <div className={`${PANEL.fontLabel} mb-2`}>{t('verif.eventsConfusion', language)}</div>
        <div className="grid grid-cols-4 lg:grid-cols-8 gap-1.5">
          {EVENT_TYPES.map(t=>{
            const m = metrics.byType[t]
            const prec = m.tp+m.fp ? m.tp/(m.tp+m.fp) : 0
            return (
              <div key={t} className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-2 bg-background/60`}>
                <div className={`text-[9px] font-mono truncate ${EVENT_COLORS_CSS[t]?.split(' ')[0]}`}>{t}</div>
                <div className="text-xs font-mono mt-1">P {(prec*100).toFixed(0)}%</div>
                <div className="text-[10px] font-mono text-muted-foreground/60">TP{m.tp} FP{m.fp} FN{m.fn}</div>
                <div className="h-1 bg-muted/20 rounded mt-1"><div className="h-1 bg-primary rounded" style={{width:`${prec*100}%`}} /></div>
              </div>
            )
          })}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground/30 mt-2">{t('verif.hint2', language)}</div>
      </div>

      {/* 照片对比列表 */}
      <div className={`${PANEL.border} ${PANEL.rounded} ${PANEL.padding} bg-background/40`}>
        <div className="flex items-center justify-between mb-2">
          <div className={PANEL.fontLabel}>{t('verif.sampleCompare', language)}</div>
          <div className="text-[10px] font-mono text-muted-foreground/40">{filtered.length} / {rows.length}</div>
        </div>
        <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
          {filtered.slice(0,12).map(r=>(
            <div key={r.id} className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-2 flex gap-3 bg-background/60`}>
              <div className="w-20 h-20 bg-muted/20 border border-border/20 rounded-sm flex items-center justify-center shrink-0 overflow-hidden">
                {r.photoUrl ? <img src={r.photoUrl} alt={r.fileName} className="w-full h-full object-cover" /> : <span className="text-[9px] font-mono text-muted-foreground/30 whitespace-pre text-center">{t('verif.photoPending', language)}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono truncate">{r.fileName}</span>
                  <span className="text-[9px] font-mono px-1 border rounded-sm border-border/40 text-muted-foreground/60">{r.material}</span>
                  <span className="text-[10px] font-mono ml-auto text-emerald-400">+¥{r.costSaved} +{r.timeSaved}m</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.predicted.length===0 ? <span className="text-[10px] font-mono text-muted-foreground/30">{t('verif.predicted', language)}{t('verif.noRisk', language)}</span> : r.predicted.map(p=><span key={p} className={`text-[9px] font-mono px-1 border rounded-sm ${EVENT_COLORS_CSS[p]}`}>{p}</span>)}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.actual.length===0 ? <span className="text-[10px] font-mono text-muted-foreground/30">{t('verif.photo', language)}{t('verif.noFailure', language)}</span> : r.actual.map(p=><span key={p} className={`text-[9px] font-mono px-1 rounded-sm bg-foreground/5 border border-border/20 ${EVENT_COLORS_CSS[p]?.split(' ')[0]}`}>{p} ✓</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] font-mono text-muted-foreground/30 border-t border-border/20 pt-2">
        {t('verif.hint', language)}
      </div>
    </div>
  )
}
