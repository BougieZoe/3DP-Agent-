import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// =============================================================================
// PWA — installable on mobile home screens + offline asset precache.
// generateSW (workbox) mode; manifest injected into the built index.html.
// Icons in client/public (generated, replaceable). Dev SW disabled by default.
// =============================================================================

const pwaPlugin = VitePWA({
  registerType: "autoUpdate",
  // Registration is done manually in client/src/main.tsx (load-deferred, PROD-only) —
  // disable vite-plugin-pwa's auto-injected register script to avoid double registration.
  injectRegister: null,
  includeAssets: ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png", "favicon-48.png"],
  manifest: {
    name: "3DP Agent",
    short_name: "3DP Agent",
    description: "3D Printing AI Consultant — predict print failures before you waste time, material, and money.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0f14",
    theme_color: "#0d0f14",
    lang: "en",
    categories: ["utilities", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
    // New SW activates immediately and takes over → auto-update without workbox-window.
    skipWaiting: true,
    clientsClaim: true,
    // 2.32 MB main bundle exceeds the 2 MB default; raise to 3 MB.
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  },
  devOptions: { enabled: false },
});

const plugins = [react(), tailwindcss(), jsxLocPlugin(), pwaPlugin];
if (process.env.ANALYZE) {
  plugins.push(
    visualizer({
      filename: path.resolve(import.meta.dirname, "dist/bundle-stats.json"),
      gzipSize: true,
      template: "raw-data",
    }),
  );
}

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      external: ['onnxruntime-web'],
    },
  },
  server: {
    port: 3000,
    strictPort: false, // Will find next available port if 3000 is busy
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      // Dev: forward bridge calls to Go backend (:8888)
      // `xfwd: true` stamps the real client address into x-forwarded-for
      "/api/cad": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/slice": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/mesh": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/tripo": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/thermal": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/memory": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/step": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      "/api/materials": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        xfwd: true,
      },
      // Dev: LLM relay
      "/api/llm": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
      },
    },
  },
});
