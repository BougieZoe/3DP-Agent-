import { contextBridge } from "electron";

// Minimal desktop flag exposed to the renderer. Used by client/src/main.tsx to
// suppress Vercel analytics in the desktop app (CAD sessions must not leave the
// machine). Must stay CommonJS output (sandboxed preloads can't be ESM).
contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  platform: process.platform,
});

// Detachable chat panel bridge (Electron only).
import { ipcRenderer as chatFloatRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopChatFloat", {
  open: (origin?: string) => chatFloatRenderer.invoke("chat-float:open", origin),
  close: () => chatFloatRenderer.invoke("chat-float:close"),
  isOpen: () => chatFloatRenderer.invoke("chat-float:is-open")
});
