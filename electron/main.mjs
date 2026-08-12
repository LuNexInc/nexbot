import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, systemPreferences, utilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startCua, stopCua, registerCuaIpc } from "./cua.mjs";
import { startSpeech, stopSpeech } from "./speech.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
// 127.0.0.1 explicitly — vite binds IPv4; a bare "localhost" here can
// resolve to ::1 and paint a black window
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");

// Packaged: the harness server ships in resources (compiled JS, zero deps)
// and runs on Electron's own Node via utilityProcess. It serves the built
// UI too, so the window talks to one origin and there is no dev proxy.
let serverProc = null;
let serverReady = true;

async function startServerOn(port) {
  const entry = path.join(process.resourcesPath, "server", "index.js");
  const proc = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
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
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#070707;color:#fcfcfc;font:15px system-ui,Segoe UI,sans-serif"><div style="text-align:center;max-width:360px"><div style="font-size:40px">⚡</div><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the bot server</h2><p style="color:#fcfcfc99;line-height:1.5">Something else is using its ports. Quit and reopen NexBot — if it keeps happening, restart your computer.</p></div></body>`,
  );

// Single instance — second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    icon: APP_ICON,
    backgroundColor: "#070707",
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
              color: "#070707",
              symbolColor: "#fcfcfc",
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

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    win.loadURL(serverReady ? `http://127.0.0.1:${SERVER_PORT}` : ERROR_PAGE);
  } else {
    win.loadURL(DEV_URL);
  }
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

  if (app.isPackaged) serverReady = await startServerPackaged();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => {
  if (!IS_MAC) app.quit();
});

let cuaCleanedUp = false;
app.on("before-quit", (e) => {
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
