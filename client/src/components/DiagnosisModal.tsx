import type { Language } from '@/lib/i18n';
import { DiagnosisPanel } from './DiagnosisPanel';

/** Standalone failed-print diagnosis popup — reachable with zero files uploaded. */
export function DiagnosisModal({ language, canRun, onNeedAuth, materialContext, geometryContext, onClose }: {
  language: Language;
  canRun: boolean;
  onNeedAuth: () => void;
  materialContext?: string;
  geometryContext?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex overflow-y-auto" onClick={onClose}>
      <div className="m-auto w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <DiagnosisPanel
          language={language}
          canRun={canRun}
          onNeedAuth={onNeedAuth}
          materialContext={materialContext}
          geometryContext={geometryContext}
        />
        <div className="mt-2 text-center">
          <button onClick={onClose} className="text-[11px] font-mono text-muted-foreground/60 hover:text-foreground transition-colors">
            CLOSE ✕
          </button>
        </div>
      </div>
    </div>
  );
}
