import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { DATA_DIR } from "./config.ts";
import { DESK_ROOT, deskPath } from "./desk.ts";

/** Files that the chat can preview without handing arbitrary filesystem paths to the browser. */
export const ARTIFACT_MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
};

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

function allowedRoots(): string[] {
  const roots = [
    join(homedir(), "AI Projects"),
    join(DATA_DIR, "desk"),
    join(homedir(), ".gemini", "antigravity-cli", "brain"),
    join(homedir(), ".codex", "brain"),
  ];
  return roots.filter((root, index) => roots.indexOf(root) === index && existsSync(root));
}

// Artifact previews are chat content, not a file browser for the harness's
// own credentials. Dotfiles (.env, .credentials) never serve anywhere, and
// the data dir's token/key material is denied by name.
const DATA_DIR_DENIED_FILES = new Set([
  "harness.json",
  "steer.json",
  "remote-access.json",
  "config.json",
  "agent-inbox.json",
  "pending-turns.json",
]);
// Non-dotfile credential files are secrets too (e.g. webmaster/SECRETS.md under
// the allowlisted AI Projects root). Deny these by basename so artifact
// previews never serve credential material.
const SECRET_BASENAMES = new Set(["secrets.md", "secrets.json", "credentials.json", "credentials", "master.key"]);

function artifactDenied(file: string): boolean {
  const base = file.slice(Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/")) + 1);
  if (!base || base.startsWith(".") || base === "master.key") return true;
  if (SECRET_BASENAMES.has(base.toLowerCase())) return true;
  const rel = relative(resolve(DATA_DIR), file);
  const insideDataDir = rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  if (insideDataDir) {
    if (rel === "wireguard" || rel.startsWith(`wireguard${sep}`)) return true; // host private key
    if (DATA_DIR_DENIED_FILES.has(base)) return true;
  }
  return false;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${candidate.includes("\\") ? "\\" : "/"}`) && !isAbsolute(rel));
}

function canonical(value: string): string | null {
  try {
    const result = realpathSync(value);
    if (!statSync(result).isFile()) return null;
    return result;
  } catch {
    return null;
  }
}

/** Resolve a file:// URL, desk:// reference, or absolute local path under an allowlisted root. */
export function resolveArtifactPath(reference: string): string | null {
  const raw = reference.trim();
  if (!raw) return null;

  let candidate: string;
  if (/^file:\/\//i.test(raw)) {
    try {
      candidate = fileURLToPath(raw);
    } catch {
      return null;
    }
  } else if (/^desk:\/\//i.test(raw)) {
    const match = raw.match(/^desk:\/\/([^/]+)(?:\/(.*))?$/i);
    if (!match) return null;
    const botRoot = deskPath(decodeURIComponent(match[1]));
    const child = decodeURIComponent(match[2] ?? "");
    candidate = resolve(botRoot, child);
  } else {
    try {
      candidate = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }

  if (!isAbsolute(candidate)) return null;
  const resolved = canonical(resolve(candidate));
  if (!resolved || !allowedRoots().some((root) => inside(resolve(root), resolved))) return null;
  if (artifactDenied(resolved)) return null;
  const ext = extname(resolved).toLowerCase();
  if (!ARTIFACT_MIME[ext]) return null;
  try {
    if (statSync(resolved).size > MAX_ARTIFACT_BYTES) return null;
  } catch {
    return null;
  }
  return resolved;
}

export function artifactMime(file: string): string {
  return ARTIFACT_MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

const RENDER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"]);
const RENDER_WORDS = /\b(render(?:s|ed|ing)?|poster(?:s)?|mockup(?:s)?|visual(?:s)?|image(?:s)?|creative|design)\b/i;

/** Find fresh image outputs that a creative/render reply should show in chat. */
export function renderArtifactsForReply(botId: string, text: string): Array<{ name: string; path: string; mime: string }> {
  if (!RENDER_WORDS.test(text)) return [];
  const botOut = join(deskPath(botId), "out");
  const outDirs = [botOut];
  if (existsSync(DESK_ROOT)) {
    for (const entry of readdirSync(DESK_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === botId) continue;
      const out = join(DESK_ROOT, entry.name, "out");
      if (existsSync(out)) outDirs.push(out);
    }
  }
  if (!outDirs.some((out) => existsSync(out))) return [];
  const tokens = new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []));
  const candidates = outDirs.flatMap((out) => readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isFile() && RENDER_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => {
      const path = join(out, entry.name);
      const words = entry.name.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
      const score = words.reduce((sum, word) => sum + (tokens.has(word) ? 1 : 0), 0);
      let mtime = 0;
      try { mtime = statSync(path).mtimeMs; } catch { /* disappeared between readdir and stat */ }
      return { name: entry.name, path, mime: artifactMime(path), score, mtime };
    }))
    .filter((entry) => entry.mtime > 0)
    .sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  if (!candidates.length) return [];
  const matched = candidates.filter((entry) => entry.score >= 2);
  const chosen = (matched.length ? matched : candidates.filter((entry) => Date.now() - entry.mtime < 48 * 60 * 60_000)).slice(0, 6);
  return chosen.map(({ name, path, mime }) => ({ name, path, mime }));
}

export function serveArtifact(res: ServerResponse, reference: string | null): boolean {
  const file = reference ? resolveArtifactPath(reference) : null;
  if (!file) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "artifact not found" }));
    return true;
  }
  try {
    const data = readFileSync(file);
    const name = file.slice(Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/")) + 1).replace(/[\r\n"\\]/g, "_");
    res.writeHead(200, {
      "content-type": artifactMime(file),
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "no-store",
      // Loopback requests are trusted by the harness gate, so artifact
      // documents must never run scripts or touch this origin.
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "artifact not found" }));
  }
  return true;
}
