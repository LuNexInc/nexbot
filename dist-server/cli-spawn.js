// Cross-platform agent CLI spawn helpers.
// Windows npm global tools install as `claude.cmd` / `codex.cmd` wrappers.
// Those need shell execution; Unix binaries spawn directly.
// Kill uses a process tree on Windows (taskkill /T) and process-group on Unix.
import { execFile, spawn, } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { augmentedPath } from "./env-path.js";
const WIN_EXTS = [".exe", ".cmd", ".bat", ""];
function pathFromEnv(env) {
    if (env?.PATH)
        return env.PATH;
    if (env?.Path)
        return env.Path;
    return augmentedPath();
}
/** Resolve a command name to a full path when possible (Windows PATHEXT aware). */
export function resolveCli(command, pathEnv = augmentedPath()) {
    if (!command)
        return command;
    // absolute / relative path already
    if (command.includes("/") || command.includes("\\") || existsSync(command)) {
        return command;
    }
    if (process.platform !== "win32")
        return command;
    const dirs = pathEnv.split(delimiter).filter(Boolean);
    const hasExt = extname(command) !== "";
    for (const dir of dirs) {
        if (hasExt) {
            const p = join(dir, command);
            if (existsSync(p))
                return p;
        }
        else {
            for (const ext of WIN_EXTS) {
                const p = join(dir, command + ext);
                if (existsSync(p))
                    return p;
            }
        }
    }
    return command;
}
function needsWinShell(resolved) {
    if (process.platform !== "win32")
        return false;
    const ext = extname(resolved).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
}
/** Spawn an agent CLI with Windows .cmd / process-tree kill behavior. */
export function spawnCli(command, args, options = {}) {
    const env = options.env ?? process.env;
    const resolved = resolveCli(command, pathFromEnv(env));
    const isWin = process.platform === "win32";
    const opts = {
        ...options,
        windowsHide: true,
        // negative PID process groups only work on Unix
        detached: isWin ? false : options.detached,
    };
    if (needsWinShell(resolved)) {
        // Required for npm's .cmd shims. Args are ours (flags, model ids), not
        // free-form shell strings from the user — prompt text goes over stdin.
        return spawn(resolved, args, { ...opts, shell: true });
    }
    return spawn(resolved, args, opts);
}
export function execFileCli(command, args, options, callback) {
    const env = options.env ?? process.env;
    const resolved = resolveCli(command, pathFromEnv(env));
    const opts = { ...options, windowsHide: true, encoding: "utf8" };
    const cb = (err, stdout, stderr) => {
        callback(err, String(stdout ?? ""), String(stderr ?? ""));
    };
    if (needsWinShell(resolved)) {
        return execFile(resolved, args, { ...opts, shell: true }, cb);
    }
    return execFile(resolved, args, opts, cb);
}
/** Stop a CLI and its children (MCP proxies, etc.). */
export function stopChild(child) {
    if (!child?.pid)
        return;
    if (process.platform === "win32") {
        try {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
            });
        }
        catch {
            try {
                child.kill();
            }
            catch {
                /* already gone */
            }
        }
        return;
    }
    try {
        process.kill(-child.pid, "SIGTERM");
    }
    catch {
        try {
            child.kill("SIGTERM");
        }
        catch {
            /* already gone */
        }
    }
}
