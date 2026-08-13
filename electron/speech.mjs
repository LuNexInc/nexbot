// Speech helper lifecycle, main-process side.
//
// macOS: Swift SFSpeechRecognizer helper (Microphone + Speech Recognition TCC).
// Windows / Linux: no native helper — renderer uses the Chromium Web Speech
// API (Composer falls back when speech:native is false).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "resources", "speech-helper.swift");
const BIN = app.isPackaged
  ? path.join(process.resourcesPath, "speech-helper")
  : path.join(__dirname, "resources", "speech-helper");

let child = null;

export function speechNativeAvailable() {
  return process.platform === "darwin" && (app.isPackaged ? existsSync(BIN) : existsSync(SRC) || existsSync(BIN));
}

function ensureBuilt() {
  if (app.isPackaged) return;
  if (process.platform !== "darwin") return;
  const stale = !existsSync(BIN) || (existsSync(SRC) && statSync(BIN).mtimeMs < statSync(SRC).mtimeMs);
  if (!stale) return;
  execFileSync("swiftc", ["-O", SRC, "-o", BIN], { stdio: "pipe", timeout: 120_000 });
}

export function startSpeech(win) {
  stopSpeech();
  if (process.platform !== "darwin") {
    // Signal renderer to use Web Speech (code 2 = use-web-speech).
    if (!win.isDestroyed()) win.webContents.send("speech:end", { code: 2 });
    return;
  }
  try {
    ensureBuilt();
  } catch (e) {
    console.error("[speech] build failed:", e);
    if (!win.isDestroyed()) win.webContents.send("speech:end", { code: 1 });
    return;
  }
  if (!existsSync(BIN)) {
    if (!win.isDestroyed()) win.webContents.send("speech:end", { code: 1 });
    return;
  }
  const proc = spawn(BIN, [], { stdio: ["ignore", "pipe", "pipe"] });
  child = proc;

  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        if (!win.isDestroyed()) win.webContents.send("speech:transcript", JSON.parse(line));
      } catch {
        /* non-JSON noise */
      }
    }
  });
  proc.on("close", (code) => {
    if (child === proc) child = null;
    if (!win.isDestroyed()) win.webContents.send("speech:end", { code });
  });
  proc.on("error", () => {
    if (child === proc) child = null;
    if (!win.isDestroyed()) win.webContents.send("speech:end", { code: 1 });
  });
}

export function stopSpeech() {
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {}
  child = null;
}
