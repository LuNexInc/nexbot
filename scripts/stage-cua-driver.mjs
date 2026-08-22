// Copy the host cua-driver binary into vendor/ for electron-builder extraResources.
// Looks at common install locations; no-op if missing (app still runs without local CUA).
import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
const exe = isWin ? "cua-driver.exe" : "cua-driver";
const outDir = join(process.cwd(), "vendor", "cua-driver");
const outFile = join(outDir, exe);

const candidates = [];
if (process.env.CUA_DRIVER_PATH) candidates.push(process.env.CUA_DRIVER_PATH);
if (isWin) {
  const la = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  candidates.push(join(la, "Programs", "Cua", "cua-driver", "bin", exe));
  candidates.push(join(homedir(), ".cua-driver", "packages", "current", exe));
} else if (process.platform === "darwin") {
  candidates.push("/Applications/CuaDriver.app/Contents/MacOS/cua-driver");
  candidates.push(join(homedir(), ".local", "bin", "cua-driver"));
} else {
  candidates.push(join(homedir(), ".local", "bin", "cua-driver"));
}

try {
  const which = isWin ? "where.exe" : "which";
  const r = spawnSync(which, ["cua-driver"], { encoding: "utf8", windowsHide: true });
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first) candidates.unshift(first);
  }
} catch {
  /* ignore */
}

const src = candidates.find((p) => p && existsSync(p));
if (!src) {
  console.warn("[stage-cua-driver] no cua-driver binary found — packaging without bundled CUA");
  console.warn(
    isWin
      ? "  install: irm https://cua.ai/driver/install.ps1 | iex"
      : "  install: curl -fsSL https://cua.ai/driver/install.sh | sh",
  );
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(src, outFile);
try {
  chmodSync(outFile, 0o755);
} catch {
  /* windows */
}
console.log(`[stage-cua-driver] staged ${src} → ${outFile}`);
