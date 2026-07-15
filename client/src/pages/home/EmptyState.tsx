import type { translations } from '@/lib/i18n';

type TKey = keyof (typeof translations)['en'];

export function EmptyState({ t }: { t: (key: TKey) => string }) {
  return (
    <div className="space-y-4">
      <div className="border border-dashed border-border/30 rounded-sm p-8 text-center space-y-2">
        <div className="text-muted-foreground/20 text-3xl font-mono">[ ]</div>
        <div className="text-xs text-muted-foreground/50 font-mono">{t('uploadStlBegin')}</div>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground/40 font-mono tracking-widest">// FEATURES</div>
        {[
          [t('featureFree'), t('feature1')],
          [t('featureFree'), t('feature2')],
          [t('featureFree'), t('feature3')],
          [t('featureAiKey'), t('feature4')],
          [t('featureAiKey'), t('feature5')],
        ].map(([badge, desc]) => (
          <div key={desc} className="flex items-center gap-3 p-2.5 border border-border/20 rounded-sm hover:border-border/50 transition-all">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded-sm border shrink-0 ${
              badge === t('featureFree') ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' : 'text-primary border-primary/30 bg-primary/5'
            }`}>{badge}</span>
            <span className="text-xs text-muted-foreground">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
