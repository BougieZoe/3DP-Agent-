/**
 * ExportOutcomePrompt — lightweight entry into the observed-outcome form after
 * an export succeeds. Closed by default so the export flow is not interrupted;
 * expanding reveals the canonical PrintOutcomeCard for the exact record.
 *
 * It never pre-fills or implies success: the user records what happened only
 * after the print actually finishes.
 */
import { PrintOutcomeCard } from './PrintOutcomeCard';
import type { RecordStore } from '@/lib/analysisHistory';
import type { Language } from '@/lib/i18n';
import { pickLang } from '@shared/i18n/content';

const L = {
  en: {
    title: 'PRINTED IT?',
    action: 'RECORD OUTCOME',
    body: 'Record what actually happened once the print finishes. This stays in this browser and is linked to this analysis run.',
  },
  ja: {
    title: '印刷しましたか？',
    action: '結果を記録',
    body: '印刷完了後に実際の結果を記録してください。このブラウザ内に保存され、この分析実行に紐づきます。',
  },
  zh: {
    title: '已经打印了吗？',
    action: '记录打印结果',
    body: '打印完成后记录实际结果。数据仅保存在此浏览器，并关联到本次分析运行。',
  },
} as const;

interface Props {
  /** Record id of the exported run; null = not recordable. */
  recordId: string | null;
  language: Language;
  /** Injectable for tests; defaults to the shared IndexedDB-backed store. */
  store?: RecordStore;
}

export function ExportOutcomePrompt({ recordId, language, store }: Props) {
  const t = pickLang(L, language);
  if (!recordId) return null;

  return (
    <details
      className="border border-primary/25 rounded-sm bg-primary/5 px-3 py-2.5"
      data-testid="export-outcome-prompt"
    >
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
        <span className="text-[10px] font-mono tracking-wider text-primary/80">{t.title}</span>
        <span className="text-[10px] font-mono text-muted-foreground/60">{t.action}</span>
      </summary>
      <p className="mt-2 mb-3 text-[11px] text-muted-foreground/60 leading-relaxed">{t.body}</p>
      <PrintOutcomeCard recordId={recordId} language={language} store={store} />
    </details>
  );
}
