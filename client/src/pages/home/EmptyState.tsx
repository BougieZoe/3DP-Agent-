import type { translations } from '@/lib/i18n';
import { FeaturesSection } from './FeaturesSection';
import type { FeatureDestination } from './featuresNavigation';

type TKey = keyof (typeof translations)['en'];

export function EmptyState({
  t,
  onNavigate,
}: {
  t: (key: TKey) => string;
  onNavigate: (dest: FeatureDestination) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="border border-dashed border-border/30 rounded-sm p-8 text-center space-y-2">
        <div className="text-muted-foreground/20 text-3xl font-mono">[ ]</div>
        <div className="text-xs text-muted-foreground/50 font-mono">{t('uploadStlBegin')}</div>
      </div>
      <FeaturesSection t={t} onNavigate={onNavigate} />
    </div>
  );
}
