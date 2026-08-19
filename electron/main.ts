import { app, BrowserWindow, dialog, shell, utilityProcess } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// =============================================================================
// 3DP Agent — Electron main process
//
// Owns the local Express engine as a child process and points the window at it:
//   - dev  (electron:dev)      → spawn `node tsx server/index.ts` on :3001, load
//                                the Vite dev server on :3000 (its /api proxy
//                                forwards to :3001, exactly like a browser tab).
//   - packaged (.app)          → utilityProcess.fork of the self-contained
//                                dist/index.cjs on :3199, load it directly
//                                (same-origin with the API, zero CORS).
//
// The engine MUST run with NODE_ENV deleted: production semantics would require
// a BRIDGE_TOKEN for every bridge and 401 the local renderer, which never sends
// one. With dev semantics the loopback guard auto-allows our 127.0.0.1 caller.
// =============================================================================

const DEV_VITE_URL = "http://127.0.0.1:3000";
const DEV_SERVER_PORT = 3001; // must match the vite dev proxy targets
const PACKAGED_PORT = 3199; // off the 3000/3001 pair dev tooling owns
const ROOT_FILE = "project-root.json";
const READY_TIMEOUT_MS = 15_000;

// ── Project root ─────────────────────────────────────────────────────────────
// The engine resolves .cad-bridge venvs, runs/, metrics and agent-traces from
// cwd. In dev that's the repo (process.cwd). Packaged: the user picks the repo
// folder once (persisted under userData) so the venvs the machine already has
// are found — bundling a Python runtime is intentionally out of scope.
function projectRoot(): string {
  if (process.env.CAD_PROJECT_ROOT) return process.env.CAD_PROJECT_ROOT;
  if (app.isPackaged) {
    const saved = path.join(app.getPath("userData"), ROOT_FILE);
    if (fs.existsSync(saved)) return fs.readFileSync(saved, "utf8").trim();
    const picked = dialog.showOpenDialogSync({
      title: "Select the 3DP Agent project folder",
      message: "Pick the folder that contains .cad-bridge (the local engine's Python environment).",
      buttonLabel: "Use this folder",
      properties: ["openDirectory"],
    });
    if (!picked || picked.length === 0) {
      dialog.showErrorBox("3DP Agent", "No project folder selected. The local engine needs it to run. Quitting.");
      app.exit(0);
      return process.cwd();
    }
    fs.writeFileSync(saved, picked[0]);
    return picked[0];
  }
  return process.cwd();
}

// ── Minimal .env reader (no dotenv dependency) ───────────────────────────────
function loadDotEnv(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function serverEnv(root: string, port: number): NodeJS.ProcessEnv {
  const env = { ...process.env, ...loadDotEnv(root) };
  delete env.NODE_ENV; // dev semantics → bridges mounted, loopback guard auto-allows us
  env.PORT = String(port);
  env.HOST = "127.0.0.1"; // never bind 0.0.0.0 from a desktop app
  env.CAD_PROJECT_ROOT = root;
  return env;
}

let serverChild: Electron.UtilityProcess | ChildProcess | null = null;

function spawnServer(root: string, port: number) {
  if (app.isPackaged) {
    // Electron's bundled Node — no dependency on system node/PATH in a GUI app.
    const entry = path.join(app.getAppPath(), "dist", "index.cjs");
    serverChild = utilityProcess.fork(entry, [], {
      cwd: root,
      env: serverEnv(root, port),
      stdio: "inherit",
    });
    serverChild.on("exit", (code) => {
      dialog.showErrorBox("3DP Agent", `The local engine stopped unexpectedly (code ${code}).`);
      app.quit();
    });
  } else {
    // Terminal-launched dev: system node + tsx run the TS source.
    const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const serverSrc = path.join(root, "server", "index.ts");
    serverChild = spawn("node", [tsxCli, serverSrc], {
      cwd: root,
      env: serverEnv(root, port),
      stdio: "inherit",
    });
    serverChild.on("error", (err) => {
      dialog.showErrorBox("3DP Agent", `Failed to start the local engine: ${err.message}`);
      app.quit();
    });
  }
}

async function waitForServer(port: number, timeoutMs = READY_TIMEOUT_MS): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        // Must be OUR engine's JSON liveness probe — the SPA catch-all would also
        // 200 with index.html, so accept only { ok: true }.
        const body = (await res.json()) as { ok?: boolean };
        if (body?.ok === true) return;
      }
    } catch {
      /* engine not up yet, or a stale server answered with HTML */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out waiting for the local engine at ${url}. ` +
      `Is another server already using port ${port}?`
  );
}

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: app.isPackaged,
    backgroundColor: "#0d0f14",
    title: "3DP Agent",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(app.getAppPath(), "dist-electron", "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => win.show());
  // Any target=_blank / window.open goes to the system browser, never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
  void win.loadURL(url);
  return win;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const root = projectRoot();
    const port = app.isPackaged ? PACKAGED_PORT : DEV_SERVER_PORT;
    spawnServer(root, port);
    try {
      await waitForServer(port);
    } catch (err) {
      dialog.showErrorBox("3DP Agent", String(err));
      app.quit();
      return;
    }
    createWindow(app.isPackaged ? `http://127.0.0.1:${port}` : DEV_VITE_URL);
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    serverChild?.kill();
  });
}
