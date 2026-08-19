import { contextBridge } from "electron";

// Minimal desktop flag exposed to the renderer. Used by client/src/main.tsx to
// suppress Vercel analytics in the desktop app (CAD sessions must not leave the
// machine). Must stay CommonJS output (sandboxed preloads can't be ESM).
contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  platform: process.platform,
});
