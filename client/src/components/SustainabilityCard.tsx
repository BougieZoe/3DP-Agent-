import { useMemo } from 'react';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';

interface Props {
  unifiedAnalysis: UnifiedAnalysis;
  material: Material;
  language: 'en' | 'ja' | 'zh';
}

const L = {
  en: { title: 'SUSTAINABILITY', waste: 'Waste', energy: 'Energy', carbon: 'CO₂', recyclable: 'Recyclable' },
  ja: { title: 'サステナビリティ', waste: '廃棄', energy: 'エネルギー', carbon: 'CO₂', recyclable: 'リサイクル' },
  zh: { title: '可持续性', waste: '浪费', energy: '能耗', carbon: '碳排', recyclable: '可回收' },
};

const MAT_ENV: Record<string, { recyclable: boolean; co2PerKg: number }> = {
  PLA: { recyclable: true, co2PerKg: 1.8 },
  PETG: { recyclable: true, co2PerKg: 2.3 },
  ABS: { recyclable: true, co2PerKg: 3.1 },
  ASA: { recyclable: true, co2PerKg: 3.0 },
  TPU: { recyclable: false, co2PerKg: 3.5 },
  Nylon: { recyclable: false, co2PerKg: 4.2 },
  PC: { recyclable: false, co2PerKg: 3.8 },
};

export function SustainabilityCard({ unifiedAnalysis, material, language }: Props) {
  const t = L[language] || L.en;

  const data = useMemo(() => {
    const m = unifiedAnalysis.metrics?.result;
    const support = unifiedAnalysis.support?.result;
    const pt = unifiedAnalysis.printTime?.result;
    if (!m || m.meshVolumeMm3 <= 0) return null;

    const volCm3 = m.meshVolumeMm3 / 1000;
    const wtKg = (volCm3 * material.densityGPerCm3) / 1000;
    const supVol = support?.totalSupportVolumeMm3 ?? 0;
    const waste = wtKg > 0 ? ((supVol / 1000 * material.densityGPerCm3 + wtKg * 0.1) / wtKg) * 100 : 0;
    const hours = pt?.estimatedPrintTimeHours ?? 0;
    const energy = hours * 0.35;
    const env = MAT_ENV[material.name] ?? { recyclable: false, co2PerKg: 3 };
    const carbon = wtKg * env.co2PerKg + energy * 0.5;

    let score = 100 - Math.min(30, waste * 0.5) - Math.min(20, energy * 2) - Math.min(15, carbon * 3);
    if (env.recyclable) score += 10;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
    const gradeColor = { A: 'text-emerald-400', B: 'text-cyan-400', C: 'text-yellow-400', D: 'text-orange-400', F: 'text-red-400' }[grade];

    return { waste: Math.round(waste), energy: energy.toFixed(1), carbon: carbon.toFixed(1), recyclable: env.recyclable, score, grade, gradeColor };
  }, [unifiedAnalysis, material]);

  if (!data) return null;

  return (
    <div className="border border-border/50 rounded-lg bg-card/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{t.title}</span>
        <span className={`text-lg font-mono font-bold ${data.gradeColor}`}>{data.grade}</span>
      </div>

      <div className="h-1.5 bg-border/20 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${data.gradeColor.replace('text-', 'bg-')}`} style={{ width: `${data.score}%` }} />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
        <span>{t.waste} {data.waste}%</span>
        <span>{t.energy} {data.energy}kWh</span>
        <span>{t.carbon} {data.carbon}kg</span>
        <span className={data.recyclable ? 'text-emerald-400/60' : 'text-muted-foreground/30'}>
          {data.recyclable ? '♻' : '—'} {t.recyclable}
        </span>
      </div>
    </div>
  );
}
