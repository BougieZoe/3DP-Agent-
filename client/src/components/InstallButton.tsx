import { useState } from "react";
import { Download, X } from "lucide-react";
import { getTranslation } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

// "Install" affordance for the mobile PWA:
//  - Chrome/Edge (Android + desktop): triggers the native install dialog; if the
//    user dismisses it, we fall back to the manual add-to-home-screen guide.
//  - iOS Safari + Huawei/HarmonyOS: no reliable programmatic install — open the
//    step-by-step guide directly (Apple has no install API; Huawei's Chromium
//    fork doesn't reliably honor beforeinstallprompt).
// Renders nothing when the app is already installed or the browser can't install.
export function InstallButton({ language }: { language: Language }) {
  const { available, kind, trigger } = useInstallPrompt();
  const [showGuide, setShowGuide] = useState(false);

  if (!available) return null;

  const handleClick = async () => {
    if (kind === "manual") {
      setShowGuide(true);
      return;
    }
    const outcome = await trigger();
    if (outcome !== "accepted") setShowGuide(true);
  };

  return (
    <>
      <button
        onClick={handleClick}
        title={getTranslation(language, "install")}
        className="text-[11px] sm:text-xs font-mono px-2 sm:px-3 py-1 border rounded-sm transition-all border-primary/40 text-primary hover:bg-primary/10 shrink-0"
      >
        <Download className="w-3 h-3 inline-block mr-1 -mt-0.5" />
        {getTranslation(language, "install")}
      </button>
      {showGuide && <InstallGuide language={language} onClose={() => setShowGuide(false)} />}
    </>
  );
}

function InstallGuide({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = (k: "installGuideTitle" | "installStep1" | "installStep2" | "installStep3" | "installStep4" | "installManualStep1" | "installManualStep2" | "installManualStep3" | "installDone" | "installNote" | "installManualNote" | "installClose") =>
    getTranslation(language, k);

  // Show the steps that match the ACTUAL device — iOS gets Safari/share steps,
  // everything else (Android, Huawei, HarmonyOS) gets the browser-menu steps.
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const steps = isIos
    ? [t("installStep1"), t("installStep2"), t("installStep3"), t("installStep4")]
    : [t("installManualStep1"), t("installManualStep2"), t("installManualStep3")];
  const note = isIos ? t("installNote") : t("installManualNote");

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex overflow-y-auto" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg w-full max-w-sm p-6 m-auto my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold font-mono">{t("installGuideTitle")}</h2>
          <button onClick={onClose} className="p-1 rounded-sm text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ol className="space-y-3 mb-4">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-sm font-mono">
              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
        <div className="text-xs font-mono text-muted-foreground/50 mb-4">{note}</div>
        <p className="text-sm font-mono text-emerald-400/80 mb-4">{t("installDone")}</p>
        <button
          onClick={onClose}
          className="w-full h-10 bg-foreground text-background rounded-sm text-sm font-mono font-bold hover:bg-foreground/90 transition-all"
        >
          {t("installClose")}
        </button>
      </div>
    </div>
  );
}
