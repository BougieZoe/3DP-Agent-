import { useEffect, useRef, useState } from 'react';
import { Box, Bot, FileText, MessageCircle, Wand2, type LucideIcon } from 'lucide-react';
import type { translations } from '@/lib/i18n';
import { FEATURE_DESTINATIONS, type FeatureDestination, type FeatureId } from './featuresNavigation';
import './features.css';

type TKey = keyof (typeof translations)['en'];

interface FeatureItem {
  id: FeatureId;
  icon: LucideIcon;
  titleKey: TKey;
  descKey: TKey;
}

// Included / runs-locally features (teal/primary accent).
const LOCAL_FEATURES: FeatureItem[] = [
  { id: 'geometry', icon: Box, titleKey: 'featuresGeometryTitle', descKey: 'featuresGeometryDesc' },
  { id: 'quickReport', icon: FileText, titleKey: 'featuresReportTitle', descKey: 'featuresReportDesc' },
  { id: 'qa', icon: MessageCircle, titleKey: 'featuresQaTitle', descKey: 'featuresQaDesc' },
];

// Requires-AI-key features (warm/orange accent — existing warning token).
const AI_FEATURES: FeatureItem[] = [
  { id: 'deepChat', icon: Bot, titleKey: 'featuresChatTitle', descKey: 'featuresChatDesc' },
  { id: 'optimize', icon: Wand2, titleKey: 'featuresOptimizeTitle', descKey: 'featuresOptimizeDesc' },
];

function FeatureGroup({
  title,
  subtitle,
  accentBorder,
  iconColor,
  items,
  t,
  keyTag = false,
  shakingId,
  onItemClick,
}: {
  title: string;
  subtitle?: string;
  accentBorder: string;
  iconColor: string;
  items: FeatureItem[];
  t: (key: TKey) => string;
  keyTag?: boolean;
  shakingId: FeatureId | null;
  onItemClick: (id: FeatureId) => void;
}) {
  return (
    <div className={`rounded-sm border-l-2 bg-card grid-bg p-3.5 space-y-3 ${accentBorder}`}>
      <div className="space-y-0.5">
        <div className="text-[11px] font-mono tracking-widest text-muted-foreground">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground/60">{subtitle}</div>
        )}
      </div>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => onItemClick(item.id)}
            className="flex items-start gap-2.5 cursor-pointer select-none rounded-sm transition-colors hover:bg-foreground/5"
          >
            <item.icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
            <div className={`min-w-0 flex-1 ${shakingId === item.id ? 'feature-shake' : ''}`}>
              <div className="text-sm font-medium text-muted-foreground leading-tight">
                {t(item.titleKey)}
              </div>
              <div className="text-xs text-muted-foreground leading-snug">{t(item.descKey)}</div>
            </div>
            {keyTag && (
              <span className="mt-0.5 shrink-0 text-[9px] font-mono px-1.5 py-0.5 border rounded-sm text-orange-400 border-orange-400/30 bg-orange-400/5">
                {t('featureAiKey')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Two-group feature overview shown in the home empty state.
 * Group 1 = included / runs locally (teal). Group 2 = requires an AI key
 * (warm orange, existing warning token). Presentation-only — the free-vs-key
 * split mirrors existing logic; all text flows through the i18n `t` function.
 *
 * Item clicks: always fire a subtle shake (tactile acknowledgement, honoring
 * prefers-reduced-motion), then dispatch the item's destination from
 * FEATURE_DESTINATIONS to `onNavigate` — the caller resolves real navigation.
 */
export function FeaturesSection({
  t,
  onNavigate,
}: {
  t: (key: TKey) => string;
  onNavigate: (dest: FeatureDestination) => void;
}) {
  const [shakingId, setShakingId] = useState<FeatureId | null>(null);
  const shakeTimer = useRef<number | null>(null);

  const handleItemClick = (id: FeatureId) => {
    // Tactile feedback always fires, before any navigation is resolved.
    if (shakeTimer.current) window.clearTimeout(shakeTimer.current);
    setShakingId(id);
    shakeTimer.current = window.setTimeout(() => setShakingId(null), 200);
    onNavigate(FEATURE_DESTINATIONS[id]);
  };

  useEffect(() => () => {
    if (shakeTimer.current) window.clearTimeout(shakeTimer.current);
  }, []);

  return (
    <div className="space-y-3">
      <FeatureGroup
        title={t('featuresIncludedTitle')}
        accentBorder="border-primary"
        iconColor="text-muted-foreground"
        items={LOCAL_FEATURES}
        t={t}
        shakingId={shakingId}
        onItemClick={handleItemClick}
      />
      <FeatureGroup
        title={t('featuresAiTitle')}
        accentBorder="border-orange-400"
        iconColor="text-muted-foreground"
        items={AI_FEATURES}
        t={t}
        keyTag
        shakingId={shakingId}
        onItemClick={handleItemClick}
      />
    </div>
  );
}
