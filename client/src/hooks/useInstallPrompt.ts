import { useCallback, useEffect, useState } from "react";

// Chrome/Edge (Android + desktop) fire `beforeinstallprompt` when the PWA is
// installable. Safari/iOS never does — there the only path is a manual
// "Add to Home Screen" guide.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallKind = "none" | "prompt" | "manual";

export interface InstallPrompt {
  /** Whether an install affordance should be shown at all. */
  available: boolean;
  /** "prompt" = native install dialog available (Chrome/Edge); "manual" = show the add-to-home-screen guide. */
  kind: InstallKind;
  /** Triggers the native install prompt. Returns "accepted" | "dismissed" (or "manual"). */
  trigger: () => Promise<"accepted" | "dismissed" | "manual">;
}

function isStandalone(): boolean {
  return (
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/**
 * Browsers that have no reliable programmatic PWA install:
 *  - iOS Safari (Apple ships no install API) — manual only.
 *  - Huawei Browser / HarmonyOS / EMUI (Chromium fork without Google Play
 *    services) — beforeinstallprompt is unreliable, so route to the guide.
 */
function isManualOnlyBrowser(): boolean {
  if (isStandalone()) return false; // already installed
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true;
  // Huawei + HarmonyOS + EMUI + Huawei Browser — broad match because real-world
  // Huawei UAs vary a lot (Build/HUAWEI tags, hw-*, HuaweiBrowser, HarmonyOS…).
  if (/huawei|harmonyos|emui|huaweibrowser|hw-/i.test(navigator.userAgent)) return true;
  return false;
}

export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault(); // suppress Chrome's auto mini-infobar; we render our own button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const trigger = useCallback(async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
      setDeferred(null); // prompt() may only be called once
      return choice.outcome;
    }
    return "manual" as const;
  }, [deferred]);

  if (installed || isStandalone()) return { available: false, kind: "none", trigger };
  if (deferred && !isManualOnlyBrowser()) return { available: true, kind: "prompt", trigger };
  if (isManualOnlyBrowser()) return { available: true, kind: "manual", trigger };
  return { available: false, kind: "none", trigger };
}
