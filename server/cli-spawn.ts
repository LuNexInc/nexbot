// Cross-platform agent CLI spawn helpers.
// Windows npm global tools install as `claude.cmd` / `codex.cmd` wrappers.
// Those need shell execution; Unix binaries spawn directly.
// Kill uses a process tree on Windows (taskkill /T) and process-group on Unix.
import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";

import { augmentedPath } from "./env-path.ts";

const WIN_EXTS = [".exe", ".cmd", ".bat", ""];

function pathFromEnv(env?: NodeJS.ProcessEnv | null): string {
  if (env?.PATH) return env.PATH;
  if (env?.Path) return env.Path;
  return augmentedPath();
}

/** Resolve a command name to a full path when possible (Windows PATHEXT aware). */
export function resolveCli(command: string, pathEnv = augmentedPath()): string {
  if (!command) return command;
  // absolute / relative path already
  if (command.includes("/") || command.includes("\\") || existsSync(command)) {
    return command;
  }
  if (process.platform !== "win32") return command;

  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const hasExt = extname(command) !== "";
  for (const dir of dirs) {
    if (hasExt) {
      const p = join(dir, command);
      if (existsSync(p)) return p;
    } else {
      for (const ext of WIN_EXTS) {
        const p = join(dir, command + ext);
        if (existsSync(p)) return p;
      }
    }
  }
  return command;
}

/** Parse an npm .cmd shim to extract the underlying Node script path.
 * Spawning node.exe directly with windowsHide: true avoids cmd.exe title flashes. */
export function unwrapCmdShim(resolved: string): { command: string; extraArgs: string[] } | null {
  if (process.platform !== "win32") return null;
  const ext = extname(resolved).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return null;
  try {
    const text = readFileSync(resolved, "utf8");
    const dir = dirname(resolved);
    const match =
      /"%_prog%"\s+"%dp0%\\([^"]+)"/i.exec(text) ||
      /"%_prog%"\s+"([^"]+)"/i.exec(text) ||
      /node(?:\.exe)?\s+"%dp0%\\([^"]+)"/i.exec(text) ||
      /node(?:\.exe)?\s+"([^"]+)"/i.exec(text);
    if (match) {
      const rel = match[1];
      const target = resolve(dir, rel);
      if (existsSync(target)) {
        return { command: process.execPath, extraArgs: [target] };
      }
    }
  } catch {
    /* fallback to shell execution */
  }
  return null;
}

function needsWinShell(resolved: string): boolean {
  if (process.platform !== "win32") return false;
  const ext = extname(resolved).toLowerCase();
  return ext === ".cmd" || ext === ".bat";
}

/** Spawn an agent CLI with Windows .cmd / process-tree kill behavior. */
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  const env = (options.env as NodeJS.ProcessEnv | undefined) ?? process.env;
  const resolved = resolveCli(command, pathFromEnv(env));
  const isWin = process.platform === "win32";
  const opts: SpawnOptions = {
    ...options,
    windowsHide: true,
    // negative PID process groups only work on Unix
    detached: isWin ? false : options.detached,
  };

  const unwrapped = unwrapCmdShim(resolved);
  if (unwrapped) {
    // The shim target is a node script. Inside the packaged app the harness
    // runs under Electron, so process.execPath is NexBot.exe — it only acts
    // as node with ELECTRON_RUN_AS_NODE. Without this, every npm-shim CLI
    // (codex et al.) dies at spawn and reports "CLI not found".
    return spawn(unwrapped.command, [...unwrapped.extraArgs, ...args], {
      ...opts,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      shell: false,
    });
  }

  if (needsWinShell(resolved)) {
    // Required for non-Node .cmd shims.
    return spawn(resolved, args, { ...opts, shell: true });
  }
  return spawn(resolved, args, opts);
}

export function execFileCli(
  command: string,
  args: string[],
  options: ExecFileOptions,
  callback: (err: Error | null, stdout: string, stderr: string) => void,
): ChildProcess {
  const env = (options.env as NodeJS.ProcessEnv | undefined) ?? process.env;
  const resolved = resolveCli(command, pathFromEnv(env));
  const opts = { ...options, windowsHide: true, encoding: "utf8" as const };
  const cb = (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
    callback(err, String(stdout ?? ""), String(stderr ?? ""));
  };
  const unwrapped = unwrapCmdShim(resolved);
  if (unwrapped) {
    // See spawnCli: the app binary only runs node scripts as node.
    return execFile(
      unwrapped.command,
      [...unwrapped.extraArgs, ...args],
      { ...opts, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, shell: false },
      cb,
    );
  }
  if (needsWinShell(resolved)) {
    return execFile(resolved, args, { ...opts, shell: true }, cb);
  }
  return execFile(resolved, args, opts, cb);
}

/** Stop a CLI and its children (MCP proxies, etc.). Resolves once the child
 * is confirmed dead, or after `timeoutMs` so an unkillable zombie can never
 * hang shutdown or an interrupt. */
export function stopChild(child: ChildProcess | null | undefined, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    // 'close' (not 'exit'): the driver's own close handler settles the turn
    // first, so a force-settle upstream only fires for a real zombie.
    child.once("close", done);
    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        // Without this listener a failed taskkill spawn raises an uncaught
        // 'error' event that the surrounding try/catch cannot intercept.
        killer.on("error", () => {
          try { child.kill(); } catch { /* already gone */ }
        });
      } catch {
        try { child.kill(); } catch { /* already gone */ }
      }
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    }
    // A child that ignores SIGTERM gets escalated so the resolve is real.
    const escalate = setTimeout(() => {
      if (child.pid == null) return;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    }, Math.min(2_000, timeoutMs));
    escalate.unref?.();
  });
}
