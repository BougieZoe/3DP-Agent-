/**
 * Quote builder (MCP-side mirror of client handoffPack).
 * Kept standalone so the MCP server has zero dependency on the web app bundle.
 */
export interface QuoteInput {
  fileName: string;
  lang: 'ja' | 'en' | 'zh';
  verdict: string;
  score: number;
  size?: string;
  volume?: string;
  weight?: string;
  time?: string;
  estimatesBlocked: boolean;
  cheapestStep?: string;
}

const T = {
  ja: { title: '見積書（ドラフト）', size: 'サイズ', volume: '体積', weight: '推定重量', time: '推定印刷時間', blocked: '体積未確定のため重量・時間・コストは算出不可。修復後に再出力してください。', cheapest: '最安の次の一手', footer: '金額欄は手入力：材料費 / 機時 / 失敗保険（docs/handoff参照）。' },
  en: { title: 'Quote (draft)', size: 'Size', volume: 'Volume', weight: 'Est. weight', time: 'Est. print time', blocked: 'Weight / time / cost unavailable — open shell. Repair first, then re-export.', cheapest: 'Cheapest next step', footer: 'Rates to fill: material / machine time / failure cover (see docs/handoff).' },
  zh: { title: '报价单（草稿）', size: '尺寸', volume: '体积', weight: '估算重量', time: '估算打印时间', blocked: '体积未确定，重量/时间/成本无法计算。请修复后再重新导出。', cheapest: '成本最低的下一步', footer: '金额栏请手填：材料费 / 机时 / 失败险（见 docs/handoff）。' },
} as const;

export function buildQuoteText(q: QuoteInput): string {
  const t = T[q.lang];
  const lines = [
    `${t.title} — ${q.fileName}`,
    `${q.verdict} (${q.score}/100)`,
    `${t.size}: ${q.size ?? '—'}`,
    `${t.volume}: ${q.volume ?? '—'}`,
    `${t.weight}: ${q.weight ?? '—'}`,
    `${t.time}: ${q.time ?? '—'}`,
  ];
  if (q.estimatesBlocked) lines.push(t.blocked);
  if (q.cheapestStep) lines.push(`${t.cheapest}: ${q.cheapestStep}`);
  lines.push(t.footer);
  return lines.join('\n');
}
