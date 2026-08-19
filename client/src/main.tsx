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
// automatically on the next reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider initialTheme="dark">
    <App />
    {!window.desktop?.isDesktop && <Analytics />}
  </ThemeProvider>
);
