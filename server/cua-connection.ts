// Local computer-use contract written by Electron main on startup.
// Electron userData:
//   macOS:  ~/Library/Application Support/<name>/
//   Windows: %APPDATA%\<name>\
//   Linux:  ~/.config/<name>/
// Read fresh each turn — Electron may restart or permissions may change.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CuaConnection = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

function parseConnection(raw: unknown): CuaConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const conn = raw as {
    mode?: string;
    mcpCommand?: string;
    mcpArgs?: string[];
    mcpEnv?: Record<string, string>;
  };
  if (conn.mode === "unavailable" || !conn.mcpCommand) return null;
  return {
    command: conn.mcpCommand,
    args: conn.mcpArgs ?? ["mcp"],
    env: conn.mcpEnv ?? {},
  };
}

function connectionRoots(): string[] {
  const names = ["NexBot", "nexbot"];
  const roots: string[] = [];
  if (process.env.APPDATA) {
    for (const n of names) roots.push(join(process.env.APPDATA, n));
  }
  if (process.env.LOCALAPPDATA) {
    for (const n of names) roots.push(join(process.env.LOCALAPPDATA, n));
  }
  for (const n of names) {
    roots.push(join(homedir(), "Library", "Application Support", n));
    roots.push(join(homedir(), ".config", n));
  }
  return roots;
}

export function readCuaConnection(): CuaConnection | null {
  if (process.env.NEXBOT_CUA_CONNECTION) {
    try {
      const path = process.env.NEXBOT_CUA_CONNECTION;
      if (existsSync(path)) {
        const parsed = parseConnection(JSON.parse(readFileSync(path, "utf8")));
        if (parsed) return parsed;
      }
    } catch {
      /* fall through to userData roots */
    }
  }

  for (const root of connectionRoots()) {
    try {
      const p = join(root, "cua-connection.json");
      if (!existsSync(p)) continue;
      const parsed = parseConnection(JSON.parse(readFileSync(p, "utf8")));
      if (parsed) return parsed;
    } catch {
      /* try the next location */
    }
  }
  return null;
}
