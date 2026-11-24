import { useMemo } from 'react';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';
import type { CostLineKey } from '@shared/domain/costLedger';
import { MATERIALS } from '@shared/domain/material';
import { calculateCostBreakdown } from '@/analysis/costCalculator';

interface Props {
  unifiedAnalysis: UnifiedAnalysis;
  material: Material;
  language: 'en' | 'ja' | 'zh';
}

const L = {
  en: {
    title: 'COST',
    complete: 'PRICED',
    lowerBound: 'LOWER BOUND',
    withheld: 'withheld',
    labels: {
      material: 'Material',
      machine: 'Machine',
      support: 'Support',
      postProcessing: 'Post',
    } as Record<CostLineKey, string>,
    risk: 'Failure risk',
    expected: 'Expected total',
    unpricedTail: 'unpriced — this total is a lower bound, not a quote',
  },
  ja: {
    title: 'コスト',
    complete: '確定',
    lowerBound: '下限値',
    withheld: '未算出',
    labels: {
      material: '材料',
      machine: '機械',
      support: 'サポート',
      postProcessing: '後処理',
    } as Record<CostLineKey, string>,
    risk: '失敗リスク',
    expected: '期待総額',
    unpricedTail: '未計上 — この合計は下限値であり見積ではない',
  },
  zh: {
    title: '成本',
    complete: '已计价',
    lowerBound: '下限',
    withheld: '未计价',
    labels: {
      material: '材料',
      machine: '机器',
      support: '支撑',
      postProcessing: '后处理',
    } as Record<CostLineKey, string>,
    risk: '失败风险',
    expected: '期望总额',
    unpricedTail: '未计价 — 该合计是下限，不是报价',
  },
};

const BAR_COLORS: Record<CostLineKey, string> = {
  material: 'bg-cyan-400',
  machine: 'bg-amber-400',
  support: 'bg-violet-400',
  postProcessing: 'bg-slate-400',
};

export function CostCard({ unifiedAnalysis, material, language }: Props) {
  const t = L[language] || L.en;

  const data = useMemo(() => {
    const pt = unifiedAnalysis.printTime?.result;
    const m = unifiedAnalysis.metrics?.result;
    // Volume-derived cost is meaningless on an open shell.
    if (!pt || !m || m.meshVolumeMm3 <= 0 || !m.volumeReliable) return null;

    const ledger = calculateCostBreakdown(unifiedAnalysis).ledger;
    if (!ledger) return null;

    // Reference-only comparison strip, deliberately kept out of the ledger total.
    const volumeCm3 = m.meshVolumeMm3 / 1000;
    const comparison = Object.entries(MATERIALS)
      .filter(([, mat]) => mat.technology === material.technology)
      .map(([name, mat]) => ({
        name,
        cost: (volumeCm3 * mat.densityGPerCm3 / 1000) * mat.pricePerKgUsd,
        isCurrent: name === material.name,
      }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 4);

    return {
      ledger,
      comparison,
      weight: pt.materialWeightGrams ?? 0,
      time: pt.estimatedPrintTimeMinutes ?? 0,
    };
  }, [unifiedAnalysis, material]);

  if (!data) return null;

  const { ledger } = data;
  const subtotal = ledger.pricedSubtotalUsd;
  const complete = ledger.isComplete;
  const priced = ledger.lines.filter(l => l.amountUsd !== null && l.amountUsd > 0);
  const unpriced = ledger.lines.filter(l => l.amountUsd === null);
  const risk = ledger.failureRisk.amountUsd;
  const expected = ledger.expectedTotalUsd;

  return (
    <div className="border border-border/50 rounded-lg bg-card/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{t.title}</span>
        <span
          className={`text-[8px] font-mono uppercase tracking-wider ${
            complete ? 'text-emerald-400/60' : 'text-amber-400/70'
          }`}
        >
          {complete ? t.complete : t.lowerBound}
        </span>
        <span className="text-lg font-mono font-bold text-primary">
          {complete ? '' : '≥'}${subtotal.toFixed(2)}
        </span>
      </div>

      {subtotal > 0 && (
        <div className="flex gap-1 h-1.5">
          {priced.map(l => (
            <div
              key={l.key}
              className={`${BAR_COLORS[l.key]} rounded-full`}
              style={{ width: `${((l.amountUsd ?? 0) / subtotal) * 100}%` }}
              title={`${t.labels[l.key]} $${(l.amountUsd ?? 0).toFixed(2)} — ${l.basis}`}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
        {ledger.lines.map(l => (
          <div key={l.key} className="flex justify-between" title={l.basis}>
            <span className="text-muted-foreground/50">{t.labels[l.key]}</span>
            <span className={l.amountUsd === null ? 'text-muted-foreground/25' : 'text-muted-foreground/70'}>
              {l.amountUsd === null ? '—' : `$${l.amountUsd.toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/40">
        <span>{data.weight.toFixed(0)}g</span>
        <span>{data.time >= 60 ? `${(data.time / 60).toFixed(1)}h` : `${data.time}m`}</span>
      </div>

      <div className="pt-1.5 border-t border-border/20 space-y-0.5 text-[9px] font-mono">
        <div className="flex justify-between">
          <span className="text-muted-foreground/50">{t.risk}</span>
          <span className={risk === null ? 'text-muted-foreground/25' : 'text-muted-foreground/70'}>
            {risk === null
              ? t.withheld
              : `$${risk.toFixed(2)}${ledger.failureRisk.basis ? ` (${ledger.failureRisk.basis})` : ''}`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground/50">{t.expected}</span>
          <span className={expected === null ? 'text-muted-foreground/25' : 'text-foreground/70'}>
            {expected === null ? t.withheld : `$${expected.toFixed(2)}`}
          </span>
        </div>
      </div>

      {unpriced.length > 0 && (
        <div className="text-[8px] font-mono text-amber-400/60 leading-tight">
          {unpriced.map(l => t.labels[l.key]).join(' · ')} {t.unpricedTail}
        </div>
      )}

      {data.comparison.length > 1 && (
        <div className="pt-1.5 border-t border-border/20">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {data.comparison.map(c => (
              <div key={c.name} className="flex justify-between text-[9px] font-mono">
                <span className={c.isCurrent ? 'text-primary' : 'text-muted-foreground/40'}>{c.name}</span>
                <span className={c.isCurrent ? 'text-primary' : 'text-muted-foreground/40'}>${c.cost.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
