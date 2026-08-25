import { useMemo } from 'react';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';

interface Props {
  unifiedAnalysis: UnifiedAnalysis;
  material: Material;
  language: 'en' | 'ja' | 'zh';
}

interface Step {
  icon: string;
  label: string;
  time: string;
  required: boolean;
}

const L = {
  en: { title: 'POST-PROCESSING', required: 'Required', optional: 'Optional' },
  ja: { title: '後処理', required: '必須', optional: 'オプション' },
  zh: { title: '后处理', required: '必须', optional: '可选' },
};

export function PostProcessingCard({ unifiedAnalysis, material, language }: Props) {
  const t = L[language] || L.en;

  const steps = useMemo<Step[]>(() => {
    const m = unifiedAnalysis.metrics?.result;
    const support = unifiedAnalysis.support?.result;
    if (!m || m.meshVolumeMm3 <= 0) return [];

    const s: Step[] = [];

    if (support && support.totalSupportVolumeMm3 > 50) {
      s.push({ icon: '✂', label: language === 'zh' ? '去支撑' : language === 'ja' ? 'サポート除去' : 'Remove supports', time: support.totalSupportVolumeMm3 > 1000 ? '30-60m' : '10-30m', required: true });
    }

    if (material.technology === 'fdm' && m.surfaceAreaMm2 > 3000) {
      s.push({ icon: ' ', label: language === 'zh' ? '打磨' : language === 'ja' ? '研磨' : 'Sanding', time: '15-30m', required: false });
    }

    if ((material.name === 'ABS' || material.name === 'ASA')) {
      s.push({ icon: '⚗', label: language === 'zh' ? '丙酮平滑' : language === 'ja' ? 'アセトン平滑' : 'Acetone smooth', time: '15-30m', required: false });
    }

    if (material.technology === 'sla') {
      s.push({ icon: '☀', label: language === 'zh' ? 'UV固化' : language === 'ja' ? 'UV硬化' : 'UV cure', time: '10-30m', required: true });
    }

    if (m.minWallThicknessMm && m.minWallThicknessMm < 1.0) {
      s.push({ icon: '⚙', label: language === 'zh' ? 'CNC精加工' : language === 'ja' ? 'CNC精密加工' : 'CNC finish', time: '1-4h', required: false });
    }

    return s;
  }, [unifiedAnalysis, material, language]);

  if (steps.length === 0) return null;

  const required = steps.filter(s => s.required);
  const optional = steps.filter(s => !s.required);

  return (
    <div className="border border-border/50 rounded-lg bg-card/30 p-3 space-y-2">
      <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{t.title}</span>

      <div className="flex flex-wrap gap-1.5">
        {required.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 text-[10px] font-mono">
            {s.icon} {s.label} <span className="text-red-400/50">{s.time}</span>
          </span>
        ))}
        {optional.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground/60 text-[10px] font-mono">
            {s.icon} {s.label} <span className="text-muted-foreground/30">{s.time}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
