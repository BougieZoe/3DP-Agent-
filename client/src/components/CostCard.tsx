import { useMemo } from 'react';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';
import { MATERIALS } from '@shared/domain/material';

interface Props {
  unifiedAnalysis: UnifiedAnalysis;
  material: Material;
  language: 'en' | 'ja' | 'zh';
}

const L = {
  en: { title: 'COST', mat: 'Material', time: 'Machine', disclaimer: 'Estimate only' },
  ja: { title: 'コスト', mat: '材料', time: '機械', disclaimer: '推定のみ' },
  zh: { title: '成本', mat: '材料', time: '机器', disclaimer: '仅为估算' },
};

export function CostCard({ unifiedAnalysis, material, language }: Props) {
  const t = L[language] || L.en;

  const data = useMemo(() => {
    const pt = unifiedAnalysis.printTime?.result;
    const m = unifiedAnalysis.metrics?.result;
    if (!pt || !m || m.meshVolumeMm3 <= 0) return null;

    const total = pt.totalCostUsd ?? 0;
    const matCost = pt.materialCostUsd ?? 0;
    const machineCost = total - matCost;

    // Material comparison
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

    return { total, matCost, machineCost, weight: pt.materialWeightGrams ?? 0, time: pt.estimatedPrintTimeMinutes ?? 0, comparison };
  }, [unifiedAnalysis, material]);

  if (!data) return null;

  return (
    <div className="border border-border/50 rounded-lg bg-card/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{t.title}</span>
        <span className="text-lg font-mono font-bold text-primary">${data.total.toFixed(2)}</span>
      </div>

      <div className="flex gap-1 h-1.5">
        <div className="bg-cyan-400 rounded-full" style={{ width: `${data.total > 0 ? (data.matCost / data.total) * 100 : 0}%` }} />
        <div className="bg-amber-400 rounded-full" style={{ width: `${data.total > 0 ? (data.machineCost / data.total) * 100 : 0}%` }} />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
        <span>{t.mat} ${(data.matCost).toFixed(2)}</span>
        <span>{t.time} ${data.machineCost.toFixed(2)}</span>
        <span>{data.weight.toFixed(0)}g · {data.time >= 60 ? `${(data.time / 60).toFixed(1)}h` : `${data.time}m`}</span>
      </div>

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
