// Off the request loop. Caps: profile 16KB, month log 8KB.
import { MEMORY_FILE_MAX, MEMORY_PROMPT_CLIP, ensureMemory, readLog, readProfile, writeLog, writeProfile } from "./desk.ts";

export const PROFILE_CAP = MEMORY_FILE_MAX;
export const LOG_CAP = 8_192;

export type MemoryJob = { botId: string; note?: string };

const queue: MemoryJob[] = [];
let scheduled = false;

function clipProfile(text: string): string {
  return text.length > PROFILE_CAP ? text.slice(0, PROFILE_CAP) : text;
}

function clipLog(text: string): string {
  return text.length > LOG_CAP ? text.slice(-LOG_CAP) : text;
}

/** Compact desk memory. Safe to call from tests synchronously. */
export function compactMemory(botId: string, note?: string): void {
  if (!botId) return;
  ensureMemory(botId);
  let profile = readProfile(botId);
  let log = readLog(botId);
  const trimmed = (note ?? "").trim().slice(0, MEMORY_PROMPT_CLIP);
  if (trimmed) {
    const stamp = new Date().toISOString().slice(0, 10);
    log = `${log}${log.endsWith("\n") || !log ? "" : "\n"}- ${stamp} ${trimmed}\n`;
  }
  profile = clipProfile(profile);
  log = clipLog(log);
  writeProfile(botId, profile);
  writeLog(botId, log);
}

function drain(): void {
  scheduled = false;
  const jobs = queue.splice(0);
  for (const job of jobs) compactMemory(job.botId, job.note);
}

/** Queue a compact. Never runs inline — setImmediate so HTTP/SSE stay unblocked. */
export function enqueueMemoryJob(botId: string, note?: string): void {
  if (!botId) return;
  queue.push({ botId, note });
  if (scheduled) return;
  scheduled = true;
  setImmediate(drain);
}

/** Tests: run queued jobs now. */
export function flushMemoryWorker(): void {
  drain();
}

export function pendingMemoryJobs(): number {
  return queue.length;
}
