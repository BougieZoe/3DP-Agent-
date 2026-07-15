import type { MaterialName } from "@/contexts/MaterialContext";
import { MATERIALS } from "@/lib/materialState";
import type { Language, translations } from '@/lib/i18n';

type TKey = keyof (typeof translations)['en'];

export function AnalysisHeader({ mode, onModeChange, materialName, onMaterialChange, language, onLanguageChange, hasApiKey, onOpenApiConfig, providerLabel, t }: {
  mode: 'analyze' | 'cad';
  onModeChange: (mode: 'analyze' | 'cad') => void;
  materialName: MaterialName;
  onMaterialChange: (name: MaterialName) => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  hasApiKey: boolean;
  onOpenApiConfig: () => void;
  providerLabel: string | null;
  t: (key: TKey) => string;
}) {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-5 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
        <span className="text-sm font-mono text-primary tracking-widest">3DP AGENT</span>
        <span className="text-xs text-muted-foreground/50 hidden sm:block">v2.0 // {mode === 'analyze' ? 'STL Analysis' : 'CAD Studio'}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {(['analyze', 'cad'] as const).map(m => (
            <button key={m} onClick={() => onModeChange(m)}
              className={`text-xs font-mono px-3 py-1 border rounded-sm transition-all ${
                mode === m ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-primary'
              }`}>
              {m === 'analyze' ? 'ANALYZE' : 'CAD STUDIO'}
            </button>
          ))}
        </div>
        <select
          value={materialName}
          onChange={(e) => onMaterialChange(e.target.value as MaterialName)}
          className="text-xs font-mono px-2 py-1 border border-border rounded-sm bg-background text-muted-foreground hover:text-primary cursor-pointer"
        >
          {(Object.keys(MATERIALS) as MaterialName[]).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <div className="flex items-center gap-0.5">
          {(['en', 'ja', 'zh'] as Language[]).map(lang => (
            <button key={lang} onClick={() => onLanguageChange(lang)}
              className={`text-xs font-mono px-2 py-1 rounded-sm transition-all ${
                language === lang ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary'
              }`}>
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={onOpenApiConfig}
          className={`text-xs font-mono px-3 py-1 border rounded-sm transition-all ${
            hasApiKey
              ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
              : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
          }`}>
          {providerLabel ? `${t('api')}: ${providerLabel}` : t('apiKeys')}
        </button>
      </div>
    </header>
  );
}
