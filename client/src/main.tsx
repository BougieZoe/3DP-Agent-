import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import { ThemeProvider } from "@/lib/ThemeContext";
import "./index.css";

// Injected by the Electron preload (window.desktop.isDesktop) — desktop builds
// talk to a local server and must not ship user CAD sessions to Vercel analytics.
declare global {
  interface Window {
    desktop?: { isDesktop: boolean };
  }
}

// PWA service worker: registered on load in production builds only (no SW in dev).
// The generated SW uses skipWaiting + clientsClaim, so new versions take over
// automatically. `updateViaCache: 'none'` forces the browser to bypass the HTTP
// cache when checking for a new SW — otherwise a cached sw.js never revalidates
// and users get stuck on the previous build's precache (the classic "I refreshed
// but still see the old UI" PWA bug). The explicit reg.update() catches updates
// earlier than the default navigation-time check, and the controllerchange
// listener reloads the page the instant a new SW takes control, so a deploy is
// never silently left on stale content.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => { reg.update().catch(() => {}); })
      .catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider initialTheme="dark">
    <App />
    {!window.desktop?.isDesktop && <Analytics />}
  </ThemeProvider>
);
