// CUA computer-use wiring for the Electron main process.
//
// macOS: EmbeddedCuaDriverHost or standalone CuaDriver.app (TCC attribution).
// Windows/Linux: unavailable unless CUA_DRIVER_PATH points at a working binary
// (local computer use is optional; cloud Box still works).
//
// Connection descriptor → <userData>/cua-connection.json for the harness.

import { app, ipcMain } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const HOST_BUNDLE_ID = "com.lunexinc.nexbot";

const INSTALLED_DRIVER_MAC = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const STANDALONE_SOCKET_MAC = path.join(
  app.getPath("home"),
  "Library/Caches/cua-driver/cua-driver.sock",
);

let embeddedHost = null;
let connection = null;

function writeConnection(conn) {
  connection = conn;
  try {
    fs.writeFileSync(
      path.join(app.getPath("userData"), "cua-connection.json"),
      JSON.stringify(conn, null, 2),
    );
  } catch (e) {
    console.error("[cua] write connection failed:", e);
  }
  return conn;
}

export function resolveDriverBinary() {
  if (process.env.CUA_DRIVER_PATH) return process.env.CUA_DRIVER_PATH;
  if (app.isPackaged) {
    const names =
      process.platform === "win32"
        ? ["cua-driver.exe", "cua-driver"]
        : ["cua-driver"];
    for (const name of names) {
      const bundled = path.join(process.resourcesPath, name);
      if (fs.existsSync(bundled)) return bundled;
    }
  }
  if (process.platform === "darwin" && fs.existsSync(INSTALLED_DRIVER_MAC)) {
    return INSTALLED_DRIVER_MAC;
  }
  return null;
}

function socketAlive(sockPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(sockPath)) return resolve(false);
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
    socketPath: conn.socketPath,
    mcpCommand: binary,
    mcpArgs: ["mcp", "--embedded", "--socket", conn.socketPath],
    mcpEnv: { CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_HOST_BUNDLE_ID: HOST_BUNDLE_ID },
  };
}

export async function startCua() {
  // Local CUA is macOS-first. On Windows, only an explicit binary path enables it.
  if (process.platform !== "darwin" && !process.env.CUA_DRIVER_PATH && !app.isPackaged) {
    return writeConnection({
      mode: "unavailable",
      reason: "local computer use (CUA) is macOS-first; set CUA_DRIVER_PATH or use a cloud computer",
    });
  }

  const binary = resolveDriverBinary();
  if (!binary) {
    return writeConnection({
      mode: "unavailable",
      reason:
        process.platform === "darwin"
          ? "cua-driver binary not found"
          : "local computer use unavailable on this platform (use cloud computer or set CUA_DRIVER_PATH)",
    });
  }

  const wantEmbedded =
    app.isPackaged || process.env.NEXBOT_CUA_EMBEDDED === "1" || process.platform !== "darwin";

  if (wantEmbedded && process.platform === "darwin") {
    try {
      return writeConnection(await startEmbedded(binary));
    } catch (err) {
      return writeConnection({
        mode: "unavailable",
        reason: `embedded host failed: ${err?.message ?? err}`,
      });
    }
  }

  if (process.platform === "darwin" && (await socketAlive(STANDALONE_SOCKET_MAC))) {
    return writeConnection({
      mode: "standalone",
      socketPath: STANDALONE_SOCKET_MAC,
      mcpCommand: binary,
      mcpArgs: ["mcp"],
      mcpEnv: {},
    });
  }

  // Non-macOS with an explicit binary: expose MCP spawn contract without embedded host.
  if (process.platform !== "darwin" && binary) {
    return writeConnection({
      mode: "external",
      mcpCommand: binary,
      mcpArgs: ["mcp"],
      mcpEnv: {},
    });
  }

  return writeConnection({
    mode: "unavailable",
    reason:
      "no running cua-driver daemon; run `cua-driver serve` or grant via `cua-driver permissions grant`",
  });
}

export function cuaPermissionsStatus() {
  const binary = resolveDriverBinary();
  if (!binary) return { available: false };
  const out = spawnSync(binary, ["permissions", "status", "--json"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  try {
    return { available: true, ...JSON.parse(out.stdout) };
  } catch {
    return { available: true, raw: out.stdout?.trim() };
  }
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
}
