import { useMemo, useState } from 'react';
import type { UnifiedAnalysis } from '@/analysis/types';
import { MATERIALS, type Material } from '@shared/domain/material';
import { resolveWasteFate, scoreBand, type ScoreBand, type WasteFate } from '@/analysis/loop';
import { loadLedger, clearLedger, ledgerTotals, ledgerToCSV, type LoopLedgerEntry } from '@/lib/loopLedger';

interface Props {
  unifiedAnalysis: UnifiedAnalysis;
  material: Material;
  language: 'en' | 'ja' | 'zh';
  onNavigate: (tab: 'geometry' | 'agents') => void;
}

const L = {
  en: {
    title: 'CIRCULARITY', firstTime: 'FIRST-TIME-RIGHT', waste: 'WASTE FATE', eol: 'END OF LIFE',
    ledger: 'LEDGER', matrix: 'PROCESS × MATERIAL', drivers: 'Top risks', fixInGeometry: 'Fix in GEOMETRY →',
    optimizeInAgents: 'Optimize in AGENTS →', noLoop: 'Run analysis with a material to see circularity.',
    months: 'mo', unknown: 'unknown', marine: 'Marine-degradable', support: 'Support', part: 'Part',
    processLoss: 'Process loss', total: 'Total waste', expectedFailureCost: 'Expected failure cost',
    exportCsv: 'Export CSV', clear: 'Clear', prints: 'prints', virgin: 'Virgin', wasteLedger: 'Waste',
    emptyLedger: 'No prints yet — upload a model to start the ledger.',
    bandHigh: 'High', bandMedium: 'Medium', bandLow: 'Low',
    heuristicNote: 'Heuristic score — not yet calibrated on print outcomes.',
  },
  ja: {
    title: 'サーキュラリティ', firstTime: '一発成功率', waste: '廃棄物の行方', eol: '終局',
    ledger: '台帳', matrix: 'プロセス × 材料', drivers: '主なリスク', fixInGeometry: 'GEOMETRYで修正 →',
    optimizeInAgents: 'AGENTSで最適化 →', noLoop: '材料を指定して解析すると表示されます。',
    months: 'ヶ月', unknown: '不明', marine: '海洋生分解', support: 'サポート', part: '本体',
    processLoss: 'プロセスロス', total: '廃棄物合計', expectedFailureCost: '失敗期待コスト',
    exportCsv: 'CSV出力', clear: 'クリア', prints: '件', virgin: '新規材料', wasteLedger: '廃棄',
    emptyLedger: 'まだ記録がありません — モデルをアップロードしてください。',
    bandHigh: '高', bandMedium: '中', bandLow: '低',
    heuristicNote: 'ヒューリスティック評価 — 実印刷結果では未検証。',
  },
  zh: {
    title: '循环', firstTime: '一次打成率', waste: '废件去向', eol: '终局',
    ledger: '台账', matrix: '工艺 × 材料', drivers: '主要风险', fixInGeometry: '去 GEOMETRY 修 →',
    optimizeInAgents: '去 AGENTS 优化 →', noLoop: '指定材料并分析后显示。',
    months: '个月', unknown: '未知', marine: '海洋可降解', support: '支撑', part: '本体',
    processLoss: '过程损耗', total: '废料合计', expectedFailureCost: '打废期望成本',
    exportCsv: '导出 CSV', clear: '清空', prints: '件', virgin: '新料', wasteLedger: '废料',
    emptyLedger: '还没有记录——上传模型开始记账。',
    bandHigh: '高', bandMedium: '中', bandLow: '低',
    heuristicNote: '启发式评分——尚未经打印结果校准。',
  },
};

const FATE_STYLE: Record<WasteFate, string> = {
  'fgf-direct': 'text-cyan-400',
  recyclable: 'text-emerald-400',
  compostable: 'text-lime-400',
  landfill: 'text-muted-foreground/60',
};

const BAND_STYLE: Record<ScoreBand, string> = {
  high: 'text-emerald-400',
  medium: 'text-yellow-400',
  low: 'text-red-400',
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border/50 rounded-lg bg-card/30 p-3 space-y-2">
      <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{title}</span>
      {children}
    </div>
  );
}

export function LoopTab({ unifiedAnalysis, material, language, onNavigate }: Props) {
  const t = L[language] || L.en;
  const loop = unifiedAnalysis.loop?.result;
  // Tab remounts on every open (conditional render in Home), so the
  // initializer snapshot is always fresh; useState only re-renders on Clear.
  const [ledger, setLedger] = useState<LoopLedgerEntry[]>(() => loadLedger());
  const totals = useMemo(() => ledgerTotals(ledger), [ledger]);

  const exportCsv = (): void => {
    const blob = new Blob([ledgerToCSV(ledger)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loop-ledger.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const clear = (): void => {
    clearLedger();
    setLedger([]);
  };

  const matrixRows = useMemo(() => {
    const rows = Object.values(MATERIALS)
      .filter((m) => m.eol)
      .map((m) => {
        const { fate } = resolveWasteFate(m.eol, m.technology, false);
        return {
          name: m.name,
          current: m.name === material.name,
          fate,
          months: m.eol?.compostMonthsRange ?? null,
          marine: m.eol?.marineDegradable ?? false,
        };
      });
    rows.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    return rows;
  }, [material.name]);

  if (!loop) {
    return (
      <div className="pt-4">
        <Panel title={t.title}>
          <div className="text-xs font-mono text-muted-foreground/60">{t.noLoop}</div>
        </Panel>
      </div>
    );
  }

  const ft = loop.firstTime;
  const w = loop.waste;
  const eol = loop.eol;

  return (
    <div className="pt-4 space-y-4">
      {/* Card 1 — first-time-right (band headline; the number is heuristic) */}
      <Panel title={`${t.title} · ${t.firstTime}`}>
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-mono font-bold ${BAND_STYLE[scoreBand(ft.score)]}`}>
            {scoreBand(ft.score) === 'high' ? t.bandHigh : scoreBand(ft.score) === 'medium' ? t.bandMedium : t.bandLow}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/60">
            {ft.score} · {t.expectedFailureCost} ${ft.expectedFailureCostUsd.toFixed(2)}
          </span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground/40">{t.heuristicNote}</div>
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-muted-foreground/50">{t.drivers}</div>
          {ft.drivers.map((d, i) => (
            <button
              key={i}
              onClick={() => onNavigate('geometry')}
              className="block w-full text-left text-[11px] font-mono text-foreground/80 hover:text-primary transition-colors"
            >
              → {d}
            </button>
          ))}
        </div>
        <button
          onClick={() => onNavigate('agents')}
          className="w-full py-1.5 text-[10px] font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all"
        >
          {t.optimizeInAgents}
        </button>
      </Panel>

      {/* Card 2 — waste fate */}
      <Panel title={`${t.title} · ${t.waste}`}>
        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-muted-foreground/80">
          <span>{t.part} {w.partGrams}g</span>
          <span>{t.support} {w.supportGrams}g</span>
          <span>{t.processLoss} {w.processLossGrams}g</span>
          <span className="text-foreground/90">{t.total} {w.totalWasteGrams}g ({(w.wasteRatio * 100).toFixed(1)}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono font-bold ${FATE_STYLE[w.fate]}`}>{w.fate}</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground/60">{w.fateReason}</div>
        <button
          onClick={() => onNavigate('geometry')}
          className="text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors"
        >
          {t.fixInGeometry}
        </button>
      </Panel>

      {/* Card 3 — end of life (range, never a point estimate) */}
      <Panel title={`${t.title} · ${t.eol}`}>
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-mono font-bold text-foreground/90">
            {eol.monthsCompost != null ? `~${eol.monthsCompost[0]}–${eol.monthsCompost[1]}${t.months}` : t.unknown}
          </span>
          <span className={eol.marineDegradable ? 'text-[10px] font-mono text-emerald-400/80' : 'text-[10px] font-mono text-muted-foreground/30'}>
            {eol.marineDegradable ? `✓ ${t.marine}` : `— ${t.marine}`}
          </span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground/60">{eol.basisNote}</div>
      </Panel>

      {/* Card 4 — ledger across uploads, local only */}
      <Panel title={`${t.title} · ${t.ledger}`}>
        {ledger.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/60">{t.emptyLedger}</div>
        ) : (
          <>
            <div className="flex justify-between text-[11px] font-mono text-muted-foreground/80">
              <span>{totals.prints} {t.prints}</span>
              <span>{t.virgin} {totals.virginKg}kg</span>
              <span>{t.wasteLedger} {totals.wasteKg}kg</span>
              <span>Ø {totals.avgScore}</span>
            </div>
            <div className="space-y-1">
              {ledger.slice(-5).reverse().map((e) => (
                <div key={`${e.fileHash}-${e.timestamp}`} className="flex items-center justify-between text-[11px] font-mono text-muted-foreground/70">
                  <span className="truncate">{e.fileName}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span>{e.totalWasteGrams}g</span>
                    <span className={FATE_STYLE[e.fate]}>{e.fate}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={exportCsv}
                className="flex-1 py-1.5 text-[10px] font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all"
              >
                {t.exportCsv}
              </button>
              <button
                onClick={clear}
                className="flex-1 py-1.5 text-[10px] font-mono border border-border/40 text-muted-foreground hover:text-foreground rounded-sm transition-all"
              >
                {t.clear}
              </button>
            </div>
          </>
        )}
      </Panel>

      {/* Card 5 — process × material matrix */}
      <Panel title={`${t.title} · ${t.matrix}`}>
        <div className="space-y-1">
          {matrixRows.map((r) => (
            <div
              key={r.name}
              className={`flex items-center justify-between text-[11px] font-mono ${r.current ? 'text-foreground' : 'text-muted-foreground/70'}`}
            >
              <span>{r.current ? `● ${r.name}` : r.name}</span>
              <span className="flex items-center gap-2">
                <span>{r.months != null ? `~${r.months[0]}–${r.months[1]}${t.months}` : `—`}</span>
                <span>{r.marine ? '✓' : '—'}</span>
                <span className={FATE_STYLE[r.fate]}>{r.fate}</span>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
