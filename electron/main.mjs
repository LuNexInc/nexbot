import { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, ipcMain, screen as electron_screen, session, shell, systemPreferences, utilityProcess } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startCua, stopCua, registerCuaIpc, cuaConnectionStatus, resolveDriverBinary } from "./cua.mjs";
import { startSpeech, stopSpeech } from "./speech.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
// 127.0.0.1 explicitly — vite binds IPv4; a bare "localhost" here can
// resolve to ::1 and paint a black window
const DEV_URL =
  process.env.ELECTRON_START_URL ??
  process.env.ELECTRON_RENDERER_URL ??
  "http://127.0.0.1:5199";
// Unpackaged `electron .` / NEXBOT_DEV=1: load Vite, never the packaged asar UI
// and never a second harness on :8799 (installed 0.3.8 owns that).
const DEV_PREVIEW = !app.isPackaged || process.env.NEXBOT_DEV === "1";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");
const START_HIDDEN = process.argv.includes("--hidden");
const AUTOSTART_PS1 = app.isPackaged
  ? path.join(process.resourcesPath, "install-autostart.ps1")
  : path.join(__dirname, "..", "scripts", "install-autostart.ps1");

// Packaged: the harness server ships in resources (compiled JS, zero deps)
// and runs on Electron's own Node via utilityProcess. It serves the built
// UI too, so the window talks to one origin and there is no dev proxy.
let serverProc = null;
let serverReady = true;

async function startServerOn(port) {
  const entry = path.join(process.resourcesPath, "server", "index.js");
  // Connect mode is persisted in ~/.nexbot/config.json. Do not force a
  // loopback bind here, or the packaged app would ignore the user's setting.
  const serverEnv = { ...process.env };
  delete serverEnv.NEXBOT_BIND;
  const proc = utilityProcess.fork(entry, [], {
    env: {
      ...serverEnv,
      NEXBOT_STATIC_DIR: path.join(process.resourcesPath, "ui"),
      NEXBOT_PORT: String(port),
      NEXBOT_CUA_CONNECTION: path.join(app.getPath("userData"), "cua-connection.json"),
    },
    stdio: "inherit",
  });
  let exited = false;
  proc.once("exit", () => {
    exited = true;
  });
  for (let i = 0; i < 40; i++) {
    if (exited) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.app === "nexbot" && body.pid === proc.pid && body.static) return proc;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    proc.kill();
  } catch {}
  return null;
}

async function startServerPackaged() {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const port of [8799, 18799, 28799]) {
      const proc = await startServerOn(port);
      if (proc) {
        serverProc = proc;
        SERVER_PORT = port;
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

const ERROR_PAGE =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#e8eaee;color:#1d1d1f;font:15px system-ui,Segoe UI,sans-serif"><div style="text-align:center;max-width:360px"><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the bot server</h2><p style="color:#1d1d1f8c;line-height:1.5">Something else is using its ports. Quit and reopen NexBot — if it keeps happening, restart your computer.</p></div></body>`,
  );

// Windows treats package.json name "nexbot" and productName "NexBot" as the
// same AppData folder, so an unpackaged preview would share the installed
// app's single-instance lock and only raise 0.3.8. Give preview its own
// userData (and therefore its own lock) and never start a harness here.
if (DEV_PREVIEW) {
  app.setPath("userData", path.join(app.getPath("appData"), "NexBot-dev"));
}

// Single instance — second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let quitting = false;
let tray = null;
let mainWin = null;

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    createWindow();
    return;
  }
  mainWin.show();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
  // A window stranded on the error page from a slow boot gets a second chance
  // every time the user asks for the app.
  if (!DEV_PREVIEW && !serverReady) recoverWindowWhenServerUp(mainWin);
}

// ── window state persistence ─────────────────────────────────────────────
function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}
function workAreaWidth() {
  try { return electron_screen.getPrimaryDisplay().workArea.width; } catch { return 1920; }
}
function workAreaHeight() {
  try { return electron_screen.getPrimaryDisplay().workArea.height; } catch { return 1080; }
}
function loadWindowState() {
  if (DEV_PREVIEW) return null; // preview never fights the installed app for state
  try {
    return JSON.parse(readFileSync(windowStateFile(), "utf8"));
  } catch {
    return null;
  }
}
function saveWindowState(win) {
  if (DEV_PREVIEW || !win || win.isDestroyed() || win.isMinimized()) return;
  try {
    writeFileSync(windowStateFile(), JSON.stringify(win.getBounds()));
  } catch {
    /* best-effort */
  }
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(APP_ICON);
    tray.setToolTip(DEV_PREVIEW ? "NexBot (preview)" : "NexBot");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open NexBot", click: () => showMainWindow() },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("click", () => showMainWindow());
  } catch (e) {
    console.error("[tray]", e);
  }
}

function createWindow() {
  // Restore last session's size/position when it looks sane — a desktop
  // product should reopen exactly where the user left it.
  const saved = loadWindowState();
  const useSaved = saved &&
    Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
    saved.width >= 900 && saved.height >= 600 &&
    saved.width <= workAreaWidth() + 40 && saved.height <= workAreaHeight() + 40;
  const win = new BrowserWindow({
    width: useSaved ? saved.width : 1440,
    height: useSaved ? saved.height : 920,
    ...(useSaved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 900,
    minHeight: 600,
    icon: APP_ICON,
    backgroundColor: "#e8eaee",
    show: false,
    ...(IS_MAC
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 16, y: 16 },
        }
      : IS_WIN
        ? {
            // Frameless chrome with Windows caption buttons over dark UI
            titleBarStyle: "hidden",
            titleBarOverlay: {
              color: "#e8eaee",
              symbolColor: "#1d1d1f",
              height: 36,
            },
          }
        : {
            // Linux and other: standard frame
            autoHideMenuBar: true,
          }),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWin = win;
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (quitting) {
      saveWindowState(win);
      return;
    }
    e.preventDefault();
    saveWindowState(win);
    win.hide();
  });

  // A crashed renderer must never strand the user on a white window.
  // Transcripts live durably in ~/.nexbot, so reloading is always safe.
  let crashReloads = 0;
  win.webContents.on("render-process-gone", (_event, details) => {
    if (quitting || details.reason === "clean-exit") return;
    console.error("[renderer gone]", details.reason);
    if (crashReloads >= 3 || win.isDestroyed()) return;
    crashReloads += 1;
    setTimeout(() => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.reload();
      } catch {}
    }, 800);
  });
  win.webContents.on("did-finish-load", () => {
    crashReloads = 0;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_PREVIEW) {
    win.loadURL(DEV_URL);
  } else if (serverReady) {
    win.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
  } else {
    // Boot still in flight (or failed): show the calm error page, then watch
    // for the harness to come up and swap to the real UI automatically. The
    // old behavior stranded users on the error page forever.
    win.loadURL(ERROR_PAGE);
    recoverWindowWhenServerUp(win);
  }

  setupAutoUpdater(win);
}

// Poll candidate ports until a NexBot harness answers, then point the window
// at it. Resolves once; safe against the window closing underneath us.
function recoverWindowWhenServerUp(win) {
  const ports = [...new Set([SERVER_PORT, 8799, 18799, 28799])];
  const deadline = Date.now() + 120_000;
  const timer = setInterval(async () => {
    if (win.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    if (Date.now() > deadline) {
      clearInterval(timer); // give up quietly; Quit + reopen stays the fallback
      return;
    }
    for (const port of ports) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.app === "nexbot") {
          clearInterval(timer);
          SERVER_PORT = port;
          serverReady = true;
          if (!win.isDestroyed()) win.loadURL(`http://127.0.0.1:${port}`);
          return;
        }
      } catch {
        /* not up yet */
      }
    }
  }, 1500);
}

// Screen preview — desktopCapturer works on Windows, macOS, and Linux.
ipcMain.handle("screen:frame", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
});

ipcMain.handle("perm:status", () => {
  const mic =
    typeof systemPreferences.getMediaAccessStatus === "function"
      ? systemPreferences.getMediaAccessStatus("microphone")
      : "unknown";
  return { mic };
});

ipcMain.handle("perm:request-mic", async () => {
  if (typeof systemPreferences.askForMediaAccess === "function") {
    try {
      return await systemPreferences.askForMediaAccess("microphone");
    } catch {
      return false;
    }
  }
  // Windows/Linux: first capture / Web Speech prompts via the OS.
  return true;
});

ipcMain.handle("perm:open-settings", (_event, pane) => {
  if (IS_MAC) {
    const panes = {
      mic: "Privacy_Microphone",
      screen: "Privacy_ScreenCapture",
      speech: "Privacy_SpeechRecognition",
    };
    return shell.openExternal(
      `x-apple.systempreferences:com.apple.preference.security?${panes[pane] ?? "Privacy"}`,
    );
  }
  if (IS_WIN) {
    // Windows 10/11 privacy deep links
    const urls = {
      mic: "ms-settings:privacy-microphone",
      screen: "ms-settings:privacy-webcam",
      speech: "ms-settings:privacy-speech",
    };
    return shell.openExternal(urls[pane] ?? "ms-settings:privacy");
  }
  return shell.openExternal("about:blank");
});

ipcMain.handle("speech:start", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) startSpeech(win);
});
ipcMain.handle("speech:stop", () => stopSpeech());

ipcMain.handle("app:platform", () => process.platform);
ipcMain.handle("notify", (_e, title, body) => {
  try {
    new Notification({ title: String(title || "NexBot"), body: String(body || "") }).show();
  } catch {}
});
ipcMain.handle("open-path", (_e, dir) => {
  if (dir) return shell.openPath(String(dir));
});

// ── auto-update (packaged builds only) ───────────────────────────────────
// electron-updater is esbuild-bundled into electron/updater.bundle.cjs at
// package time (scripts/build-updater.mjs) because the shipped app carries
// zero node_modules. Absent bundle → the UI shows the GitHub-releases path.
let updater = null;
let updateReadyVersion = null;
async function setupAutoUpdater(win) {
  const send = (state, version) => {
    if (!win.isDestroyed()) win.webContents.send("update:status", { state, version });
  };
  const bundlePath = path.join(__dirname, "updater.bundle.cjs");
  if (!app.isPackaged || DEV_PREVIEW || !existsSync(bundlePath)) {
    send("unsupported");
    return;
  }
  try {
    updater = (await import("./updater.bundle.cjs")).autoUpdater;
  } catch (e) {
    console.error("[updater] bundle unavailable:", e);
    send("unsupported");
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("checking-for-update", () => send("checking"));
  updater.on("update-not-available", () => send("up-to-date"));
  updater.on("update-available", (info) => send("downloading", info?.version));
  updater.on("update-downloaded", (info) => {
    updateReadyVersion = info?.version ?? null;
    send("ready", info?.version);
  });
  updater.on("error", () => send("error"));
  // Boot matters more than updates — give the harness a quiet quarter minute,
  // then re-check a few times a day.
  setTimeout(() => updater.checkForUpdates().catch(() => {}), 15_000);
  setInterval(() => updater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}
ipcMain.handle("update:install", () => {
  if (!updateReadyVersion || !updater) return;
  quitting = true; // the close handler hides to tray unless this is set
  updater.quitAndInstall();
});

function runAutostart(mode) {
  const { spawnSync } = require("node:child_process");
  const exe = app.isPackaged ? process.execPath : "";
  const args = ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", AUTOSTART_PS1, "-Mode", mode];
  if (exe) args.push("-Exe", exe);
  const r = spawnSync("powershell.exe", args, { windowsHide: true, encoding: "utf8" });
  try {
    return JSON.parse(String(r.stdout || "").trim());
  } catch {
    return { installed: false, error: String(r.stderr || r.status) };
  }
}

ipcMain.handle("desktop:capabilities", () => {
  const conn = cuaConnectionStatus();
  const binary = resolveDriverBinary();
  const cuaReady = Boolean(binary && conn && conn.mode !== "unavailable");
  const platform = process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
    ? process.platform
    : "browser";
  const labels = { darwin: "macOS", linux: "Linux", win32: "Windows", browser: "Browser" };
  return {
    host: { platform, label: labels[platform], packaged: app.isPackaged },
    screenPreview: { available: true },
    dictation: {
      available: true,
      engine: platform === "darwin" ? "apple-speech" : "web-speech",
    },
    localComputer: cuaReady
      ? { available: true, support: "supported" }
      : { available: false, support: "unsupported", reasonCode: binary ? "cua-not-ready" : "cua-driver-missing" },
  };
});
ipcMain.handle("autostart:status", () => runAutostart("status"));
ipcMain.handle("autostart:set", (_e, on) => runAutostart(on ? "on" : "off"));

let watchWin = null;
ipcMain.handle("watch:open", (_event, botId) => {
  const qs = botId ? `?bot=${encodeURIComponent(String(botId))}` : "";
  const origin = DEV_PREVIEW ? DEV_URL.replace(/\/$/, "") : `http://127.0.0.1:${SERVER_PORT}`;
  const url = `${origin}/watch.html${qs}`;
  if (watchWin && !watchWin.isDestroyed()) {
    watchWin.loadURL(url);
    watchWin.focus();
    return;
  }
  watchWin = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 480,
    minHeight: 320,
    icon: APP_ICON,
    backgroundColor: "#e8eaee",
    title: "NexBot · screen",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  watchWin.on("closed", () => {
    watchWin = null;
  });
  watchWin.loadURL(url);
});

app.whenReady().then(async () => {
  if (IS_MAC) app.dock.setIcon(APP_ICON);

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  registerCuaIpc();
  // CUA is macOS-primary today; Windows degrades to unavailable without a binary.
  startCua().catch((e) => console.error("[cua] start failed:", e));

  // Packaged 0.3.8 already owns :8799. Preview never forks a second harness.
  // createWindow() reads `serverReady`; windows made mid-boot land on the
  // error page and self-recover via recoverWindowWhenServerUp().
  if (app.isPackaged && !DEV_PREVIEW) {
    serverReady = await startServerPackaged();
  }
  createTray();
  if (!START_HIDDEN) createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", (_e, argv) => {
  if (argv.includes("--hidden")) return;
  showMainWindow();
});

app.on("window-all-closed", () => {
  /* stay in the tray so routines and in-flight turns keep running */
});

let cuaCleanedUp = false;
app.on("before-quit", (e) => {
  quitting = true;
  if (cuaCleanedUp) return;
  e.preventDefault();
  try {
    serverProc?.kill();
  } catch {}
  stopCua().finally(() => {
    cuaCleanedUp = true;
    app.quit();
  });
});
