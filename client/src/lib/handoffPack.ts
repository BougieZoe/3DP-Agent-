/**
 * Handoff Pack — one-tap quote text generated from a finished analysis.
 *
 * Score/light come from getTrafficLight (single writer); weight/time ranges
 * reuse ReportGenerator's canonical formatters. This module only assembles
 * the copy-paste text — no rates live here (rates are filled in by hand from
 * docs/handoff, which never ships real numbers).
 */

import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis } from '../analysis/types';
import { getTrafficLight } from '../components/reportUtils';
import { isVolumeReportable } from './volumeDisplay';
import { computeWeightRange, computeTimeRange } from '../components/ReportGenerator';
import { cheapestStep } from './cheapestStep';

type Language = ContentLang;

export function buildQuoteText(
  analysis: UnifiedAnalysis,
  fileName: string,
  lang: Language,
): string {
  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;

  const verdict =
    light === 'red'
      ? translate(CONTENT, 'pdf.verdict.notReady', lang)
      : light === 'yellow'
        ? translate(CONTENT, 'pdf.verdict.review', lang)
        : translate(CONTENT, 'pdf.verdict.ready', lang);

  const size = dims
    ? `${dims.x.toFixed(0)} × ${dims.y.toFixed(0)} × ${dims.z.toFixed(0)} mm`
    : '—';
  const volume =
    metrics && isVolumeReportable(metrics)
      ? `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³`
      : '—';
  const weight =
    pt?.materialWeightGrams != null && pt.materialWeightGrams > 0
      ? computeWeightRange(pt.materialWeightGrams, lang)
      : '—';
  const time =
    pt?.estimatedPrintTimeMinutes != null && pt.estimatedPrintTimeMinutes > 0
      ? computeTimeRange(pt.estimatedPrintTimeMinutes, lang)
      : '—';
  const volumeBlocked = !metrics || !isVolumeReportable(metrics);

  const step = cheapestStep(analysis);
  const cheapestMap = {
    repair: translate(CONTENT, 'pdf.cheapest.repair', lang),
    scale: translate(CONTENT, 'pdf.cheapest.scale', lang),
    support: translate(CONTENT, 'pdf.cheapest.support', lang),
    none: '',
  } as const;
  const cheapest = cheapestMap[step];

  const L = (key: string, vars?: Record<string, string | number>) =>
    translate(CONTENT, key, lang, vars);
  const lines = [
    `${L('handoff.quoteTitle')} — ${fileName}`,
    `${verdict} (${score}/100)`,
    `${L('pdf.label.size')}: ${size}`,
    `${L('pdf.label.volume')}: ${volume}`,
    `${L('pdf.label.weight')}: ${weight}`,
    `${L('pdf.label.time')}: ${time}`,
  ];
  if (volumeBlocked) lines.push(L('pdf.estimate.unavailable'));
  if (light !== 'green') lines.push(`${L('pdf.nextStep.cheapest')}: ${cheapest}`);
  lines.push(L('handoff.quoteFooter'));
  return lines.join('\n');
}
