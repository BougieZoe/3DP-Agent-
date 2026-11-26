import { useMemo } from 'react';
import type { Language } from '@/lib/i18n';
import { pickLang } from '@shared/i18n/content';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';

interface Props {
  unifiedAnalysis: UnifiedAnalysis;
  material: Material;
  language: Language;
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
  ko: { title: '후처리', required: '필수', optional: '선택' },
  de: { title: 'NACHBEARBEITUNG', required: 'Erforderlich', optional: 'Optional' },
  es: { title: 'POSTPROCESADO', required: 'Requerido', optional: 'Opcional' },
  fr: { title: 'POST-TRAITEMENT', required: 'Requis', optional: 'Facultatif' },
  it: { title: 'POST-PROCESSO', required: 'Richiesto', optional: 'Facoltativo' },
  sv: { title: 'EFTERBEARBETNING', required: 'Krävs', optional: 'Valfritt' },
};

/** Step labels used to be inline `language === 'zh' ? … : …` ternaries, which
 *  meant every language outside en/ja/zh silently rendered English. They live
 *  in a table now so new languages are a data change, not a code change. */
const STEP_LABELS = {
  en: { removeSupports: 'Remove supports', sanding: 'Sanding', acetone: 'Acetone smooth', uvCure: 'UV cure', cnc: 'CNC finish' },
  ja: { removeSupports: 'サポート除去', sanding: '研磨', acetone: 'アセトン平滑', uvCure: 'UV硬化', cnc: 'CNC精密加工' },
  zh: { removeSupports: '去支撑', sanding: '打磨', acetone: '丙酮平滑', uvCure: 'UV固化', cnc: 'CNC精加工' },
  ko: { removeSupports: '서포트 제거', sanding: '샌딩', acetone: '아세톤 평활', uvCure: 'UV 경화', cnc: 'CNC 정삭' },
  de: { removeSupports: 'Stützen entfernen', sanding: 'Schleifen', acetone: 'Aceton-Glättung', uvCure: 'UV-Härtung', cnc: 'CNC-Nachbearbeitung' },
  es: { removeSupports: 'Retirar soportes', sanding: 'Lijado', acetone: 'Alisado con acetona', uvCure: 'Curado UV', cnc: 'Acabado CNC' },
  fr: { removeSupports: 'Retirer les supports', sanding: 'Ponçage', acetone: 'Lissage à l\'acétone', uvCure: 'Durcissement UV', cnc: 'Finition CNC' },
  it: { removeSupports: 'Rimozione supporti', sanding: 'Levigatura', acetone: 'Levigatura con acetone', uvCure: 'Indurimento UV', cnc: 'Finitura CNC' },
  sv: { removeSupports: 'Ta bort stöd', sanding: 'Slipning', acetone: 'Acetonutjämning', uvCure: 'UV-härdning', cnc: 'CNC-efterbearbetning' },
};

export function PostProcessingCard({ unifiedAnalysis, material, language }: Props) {
  const t = pickLang(L, language);
  const stepLabels = pickLang(STEP_LABELS, language);

  const steps = useMemo<Step[]>(() => {
    const m = unifiedAnalysis.metrics?.result;
    const support = unifiedAnalysis.support?.result;
    // Step durations are volume-derived and meaningless on an open shell.
    if (!m || m.meshVolumeMm3 <= 0 || !m.volumeReliable) return [];

    const s: Step[] = [];

    if (support && support.totalSupportVolumeMm3 > 50) {
      s.push({ icon: '✂', label: stepLabels.removeSupports, time: support.totalSupportVolumeMm3 > 1000 ? '30-60 min' : '10-30 min', required: true });
    }

    if (material.technology === 'fdm' && m.surfaceAreaMm2 > 3000) {
      s.push({ icon: ' ', label: stepLabels.sanding, time: '15-30 min', required: false });
    }

    if ((material.name === 'ABS' || material.name === 'ASA')) {
      s.push({ icon: '⚗', label: stepLabels.acetone, time: '15-30 min', required: false });
    }

    if (material.technology === 'sla') {
      s.push({ icon: '☀', label: stepLabels.uvCure, time: '10-30 min', required: true });
    }

    if (m.minWallThicknessMm && m.minWallThicknessMm < 1.0) {
      s.push({ icon: '⚙', label: stepLabels.cnc, time: '1-4h', required: false });
    }

    return s;
  }, [unifiedAnalysis, material, stepLabels]);

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
