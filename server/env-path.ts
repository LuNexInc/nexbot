// PATH augmentation for GUI launches — the fix for "CLI not found" when
// the app is opened from Finder / Start menu / shortcut.
//
// A macOS app launched from Finder inherits a bare PATH
// (/usr/bin:/bin:...): no ~/.local/bin (the claude installer default),
// no /opt/homebrew/bin, and no nvm/volta/asdf shims — those only exist
// in interactive shells. Windows GUI apps usually inherit the user PATH,
// but still miss npm global shims when the installer wrote them after
// login, or when Local AppData npm is not on PATH.
//
// Every spawn of an agent CLI goes through augmentedPath(): inherited
// PATH, well-known install locations, plus (Unix) a best-effort login
// shell probe.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** nvm keeps every node version's bin dir separately; newest first so a
 * CLI installed under the latest node wins. */
function nvmBinDirs(): string[] {
  try {
    const base = join(homedir(), ".nvm", "versions", "node");
    return readdirSync(base)
      .filter((v) => v.startsWith("v"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => join(base, v, "bin"));
  } catch {
    return [];
  }
}

function knownDirsUnix(): string[] {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".deno", "bin"),
    join(home, "bin"),
    ...nvmBinDirs(),
  ];
}

function knownDirsWin(): string[] {
  const home = homedir();
  const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  const roaming = process.env.APPDATA || join(home, "AppData", "Roaming");
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    join(roaming, "npm"), // npm global .cmd shims (claude.cmd, codex.cmd)
    join(local, "npm"),
    join(local, "Programs", "nodejs"),
    join(pf, "nodejs"),
    join(pf86, "nodejs"),
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, "AppData", "Roaming", "npm"),
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".deno", "bin"),
    join(home, "bin"),
    ...nvmBinDirs(),
  ];
}

function knownDirs(): string[] {
  return process.platform === "win32" ? knownDirsWin() : knownDirsUnix();
}

let cached: string | null = null;
let probed = false;

/** Current best PATH, synchronously. Cheap after the first call. */
export function augmentedPath(): string {
  if (cached === null) {
    const inherited = process.env.PATH || process.env.Path || "";
    cached = mergePaths([
      ...(process.env.NEXBOT_EXTRA_PATH ? process.env.NEXBOT_EXTRA_PATH.split(delimiter) : []),
      ...inherited.split(delimiter),
      ...knownDirs().filter((d) => existsSync(d)),
    ]);
  }
  // Unix: fold in the login shell's PATH once in the background.
  if (!probed && !process.env.VITEST && process.platform !== "win32") {
    probed = true;
    probeLoginShellPath();
  }
  return cached;
}

function mergePaths(parts: string[]): string {
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}

function probeLoginShellPath(): void {
  const shell = process.env.SHELL || "/bin/zsh";
  // -l -i: nvm and friends live in .zshrc/.bashrc, which only interactive
  // shells read. A marker isolates $PATH from any rc-file noise.
  execFile(
    shell,
    ["-l", "-i", "-c", 'printf "__NEXBOT_PATH__%s" "$PATH"'],
    { timeout: 5000 },
    (err, stdout) => {
      if (err || !stdout) return;
      const m = /__NEXBOT_PATH__([^\n]*)/.exec(stdout);
      if (!m || !m[1]) return;
      cached = mergePaths([...(cached ?? "").split(delimiter), ...m[1].split(delimiter)]);
    },
  );
}

/** Test hook — the cache is process-wide otherwise. */
export function resetPathCacheForTests(): void {
  cached = null;
  probed = false;
}
