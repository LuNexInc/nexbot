// Bounded NDJSON logs for events/ and native/. Append is still best-effort:
// a full disk or a missing directory must never take down a turn.
import { appendFileSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { EVENTS_DIR, NATIVE_DIR } from "./config.ts";

export const EVENT_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const EVENT_LOG_RETAIN_MS = 14 * 24 * 60 * 60 * 1000;

export function nativeLogEnabled(): boolean {
  const value = process.env.NEXBOT_NATIVE_LOG?.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off") return false;
  return true;
}

// The event hot path appends constantly; stat-ing the file before every
// append doubles the syscalls per streamed token. Track sizes in memory
// (bumped on write, reset on rotate) and re-stat at most once a minute so
// an external deletion is still noticed.
const SIZE_CACHE_TTL_MS = 60_000;
const sizeCache = new Map<string, { size: number; at: number }>();

function cachedSize(file: string): number | null {
  const hit = sizeCache.get(file);
  if (hit && Date.now() - hit.at < SIZE_CACHE_TTL_MS) return hit.size;
  try {
    const size = statSync(file).size;
    sizeCache.set(file, { size, at: Date.now() });
    return size;
  } catch {
    return null;
  }
}

function bumpCachedSize(file: string, bytes: number): void {
  const hit = sizeCache.get(file);
  if (hit && Date.now() - hit.at < SIZE_CACHE_TTL_MS) {
    hit.size += bytes;
  } else {
    sizeCache.delete(file); // stale or absent — the next rotate re-stats
  }
}

export function appendNdjson(
  dir: string,
  threadId: string,
  value: unknown,
  maxBytes = EVENT_LOG_MAX_BYTES,
): void {
  const line = JSON.stringify(value) + "\n";
  const file = join(dir, `${threadId}.ndjson`);
  try {
    rotateIfOversized(file, maxBytes);
  } catch {
    /* rotate is best-effort */
  }
  appendFileSync(file, line);
  bumpCachedSize(file, Buffer.byteLength(line));
}

export function rotateIfOversized(file: string, maxBytes = EVENT_LOG_MAX_BYTES): void {
  const size = cachedSize(file);
  if (size == null || size < maxBytes) return;
  const rotated = `${file}.1`;
  try {
    unlinkSync(rotated);
  } catch {
    /* no previous rotate */
  }
  renameSync(file, rotated);
  sizeCache.set(file, { size: 0, at: Date.now() });
}

export function pruneEventLogs(
  now = Date.now(),
  dirs: string[] = [EVENTS_DIR, NATIVE_DIR],
  retainMs = EVENT_LOG_RETAIN_MS,
  maxBytes = EVENT_LOG_MAX_BYTES,
): { removed: number; rotated: number } {
  let removed = 0;
  let rotated = 0;
  const cutoff = now - retainMs;
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".ndjson") && !name.endsWith(".ndjson.1")) continue;
      const file = join(dir, name);
      try {
        const st = statSync(file);
        if (st.mtimeMs < cutoff) {
          unlinkSync(file);
          removed += 1;
          continue;
        }
        if (name.endsWith(".ndjson") && st.size >= maxBytes) {
          rotateIfOversized(file, maxBytes);
          rotated += 1;
        }
      } catch {
        /* skip an unreadable file */
      }
    }
  }
  return { removed, rotated };
}
