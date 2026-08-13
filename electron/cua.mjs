// CUA computer-use for Electron main.
//
// Spawns/hosts the official cua-driver binary (trycua) so local agents get
// computer tools via `cua-driver mcp`. Electron main owns the process so
// OS permissions attribute to NexBot.
//
// Descriptor → <userData>/cua-connection.json for the harness (and
// NEXBOT_CUA_CONNECTION when packaged).

import { app, ipcMain } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_BUNDLE_ID = "com.lunexinc.nexbot";

let embeddedHost = null;
let connection = null;

function writeConnection(conn) {
  connection = conn;
  try {
    const out = path.join(app.getPath("userData"), "cua-connection.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(conn, null, 2));
  } catch (e) {
    console.error("[cua] write connection failed:", e);
  }
  return conn;
}

/** Candidate paths for the cua-driver executable (not the UniFFI DLL). */
export function resolveDriverBinary() {
  if (process.env.CUA_DRIVER_PATH && fs.existsSync(process.env.CUA_DRIVER_PATH)) {
    return process.env.CUA_DRIVER_PATH;
  }

  const home = app.getPath("home");
  const localApp = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const isWin = process.platform === "win32";
  const exe = isWin ? "cua-driver.exe" : "cua-driver";

  const candidates = [];

  // Packaged app resources (outside asar)
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, exe));
    candidates.push(path.join(process.resourcesPath, "cua-driver", exe));
  }

  // Dev: electron/resources/ or project vendor/
  candidates.push(path.join(__dirname, "resources", exe));
  candidates.push(path.join(__dirname, "..", "vendor", "cua-driver", exe));

  // Official installer layouts (Windows)
  if (isWin) {
    candidates.push(path.join(localApp, "Programs", "Cua", "cua-driver", "bin", exe));
    candidates.push(path.join(home, ".cua-driver", "packages", "current", exe));
    // older trycua path from install.ps1 migration notes
    candidates.push(path.join(localApp, "Programs", "trycua", "cua-driver-rs", "bin", exe));
  }

  // Official installer layouts (macOS / Linux)
  if (process.platform === "darwin") {
    candidates.push("/Applications/CuaDriver.app/Contents/MacOS/cua-driver");
    candidates.push(path.join(home, ".local", "bin", "cua-driver"));
  }
  if (process.platform === "linux") {
    candidates.push(path.join(home, ".local", "bin", "cua-driver"));
    candidates.push("/usr/local/bin/cua-driver");
  }

  // PATH lookup
  try {
    const which = isWin ? "where.exe" : "which";
    const out = spawnSync(which, [isWin ? "cua-driver" : "cua-driver"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    if (out.status === 0 && out.stdout) {
      const first = out.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) candidates.unshift(first);
    }
  } catch {
    /* ignore */
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function standaloneSocketPaths() {
  const home = app.getPath("home");
  if (process.platform === "darwin") {
    return [path.join(home, "Library/Caches/cua-driver/cua-driver.sock")];
  }
  if (process.platform === "win32") {
    // Named pipe or unix socket under user profile (driver-version dependent)
    return [
      path.join(home, ".cua-driver", "cua-driver.sock"),
      path.join(os.tmpdir(), "cua-driver.sock"),
    ];
  }
  return [path.join(home, ".cache/cua-driver/cua-driver.sock"), "/tmp/cua-driver.sock"];
}

function socketAlive(sockPath) {
  return new Promise((resolve) => {
    if (!sockPath || !fs.existsSync(sockPath)) return resolve(false);
    const s = net.createConnection(sockPath);
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 1500).unref();
  });
}

async function startEmbedded(binary) {
  const { EmbeddedCuaDriverHost } = await import("@trycua/cua-driver/embedded");
  embeddedHost = new EmbeddedCuaDriverHost(binary, HOST_BUNDLE_ID);
  const conn = await embeddedHost.start();
  return {
    mode: "embedded",
    platform: process.platform,
    socketPath: conn.socketPath,
    mcpCommand: binary,
    mcpArgs: ["mcp", "--embedded", "--socket", conn.socketPath],
    mcpEnv: {
      CUA_DRIVER_EMBEDDED: "1",
      CUA_DRIVER_HOST_BUNDLE_ID: HOST_BUNDLE_ID,
    },
  };
}

/**
 * Start CUA for this app session.
 * Prefer embedded host (packaged or NEXBOT_CUA_EMBEDDED=1).
 * Else attach to a running standalone daemon if present.
 * Else expose external MCP contract if the binary exists (agent spawns `mcp`).
 */
export async function startCua() {
  const binary = resolveDriverBinary();

  if (!binary) {
    return writeConnection({
      mode: "unavailable",
      platform: process.platform,
      reason:
        process.platform === "win32"
          ? "cua-driver not found — install with: irm https://cua.ai/driver/install.ps1 | iex"
          : "cua-driver not found — install with: curl -fsSL https://cua.ai/driver/install.sh | sh",
      installHint:
        process.platform === "win32"
          ? "irm https://cua.ai/driver/install.ps1 | iex"
          : "curl -fsSL https://cua.ai/driver/install.sh | sh",
    });
  }

  const forceEmbedded =
    app.isPackaged ||
    process.env.NEXBOT_CUA_EMBEDDED === "1" ||
    process.env.NEXBOT_CUA_EMBEDDED === "true";

  // Embedded host on all platforms when forced or when no standalone socket is up.
  if (forceEmbedded) {
    try {
      return writeConnection(await startEmbedded(binary));
    } catch (err) {
      console.error("[cua] embedded host failed:", err);
      // fall through to standalone / external
    }
  }

  for (const sock of standaloneSocketPaths()) {
    if (await socketAlive(sock)) {
      return writeConnection({
        mode: "standalone",
        platform: process.platform,
        socketPath: sock,
        mcpCommand: binary,
        mcpArgs: ["mcp"],
        mcpEnv: {},
      });
    }
  }

  // Binary present: try embedded even in dev (best local computer use).
  if (!forceEmbedded) {
    try {
      return writeConnection(await startEmbedded(binary));
    } catch (err) {
      console.error("[cua] embedded host (dev) failed:", err);
    }
  }

  // Last resort: agents spawn the binary's MCP subcommand (starts/attaches as driver defines).
  return writeConnection({
    mode: "external",
    platform: process.platform,
    mcpCommand: binary,
    mcpArgs: ["mcp"],
    mcpEnv: {},
    binary,
  });
}

export function cuaPermissionsStatus() {
  const binary = resolveDriverBinary();
  if (!binary) {
    return {
      available: false,
      binary: null,
      connection: connection?.mode ?? "unavailable",
    };
  }
  const out = spawnSync(binary, ["permissions", "status", "--json"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  try {
    return {
      available: true,
      binary,
      connection: connection?.mode ?? null,
      ...JSON.parse(out.stdout || "{}"),
    };
  } catch {
    return {
      available: true,
      binary,
      connection: connection?.mode ?? null,
      raw: (out.stdout || out.stderr || "").trim(),
      exitCode: out.status,
    };
  }
}

export function cuaConnectionStatus() {
  return connection;
}

export async function stopCua() {
  if (embeddedHost) {
    try {
      await embeddedHost.stop();
      embeddedHost.uniffiDestroy?.();
    } catch {
      /* host death closes the daemon */
    }
    embeddedHost = null;
  }
}

export function registerCuaIpc() {
  ipcMain.handle("cua:connection", () => connection);
  ipcMain.handle("cua:permissions", () => cuaPermissionsStatus());
  ipcMain.handle("cua:binary", () => resolveDriverBinary());
}
