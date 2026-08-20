import { getTranslation, type Language } from '@/lib/i18n';

/** Honest, concise data-collection disclosure. Not a legal document. */
export function PrivacyModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex overflow-y-auto" onClick={onClose}>
      <div className="m-auto w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="border border-border bg-card rounded-sm p-5 font-mono text-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-primary tracking-widest">{t('privacyTitle')}</span>
            <button onClick={onClose} className="p-1 rounded-sm text-muted-foreground hover:text-foreground" aria-label="Close">✕</button>
          </div>
          <div className="text-muted-foreground/70 leading-relaxed space-y-2">
            <p>{t('privacyLocal')}</p>
            <p>{t('privacyAnalytics')}</p>
            <p>{t('privacyTraces')}</p>
            <p className="text-foreground/90">{t('privacyNoSale')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
