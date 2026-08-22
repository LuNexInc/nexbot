// Recurring jobs. The harness process must stay running (tray).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";
import { importJsonIfNeeded, loadRoutinesFromDb, persistRoutines } from "./db.ts";

export type Routine = {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  kind?: "cron" | "webhook" | "file";
  webhookSecret?: string;
  githubRepo?: string;
  watchPath?: string;
  everyMinutes?: number;
  dailyAt?: string;
  weekdaysOnly?: boolean;
  onComplete?: { targetBotId: string; messageTemplate?: string };
  maxTokens?: number;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
};

const FILE = join(DATA_DIR, "routines.json");

function load(): Routine[] {
  importJsonIfNeeded();
  return loadRoutinesFromDb();
}

function save(list: Routine[]) {
  persistRoutines(list);
}

export function isCronRoutine(r: Pick<Routine, "kind">): boolean {
  return !r.kind || r.kind === "cron";
}

export function normalizeRoutineKind(kind: unknown): "cron" | "webhook" | "file" {
  if (kind === "webhook") return "webhook";
  if (kind === "file" || kind === "file-watch") return "file";
  return "cron";
}

/** HH:MM in 00–23:00–59. Null when missing/invalid — callers must not clamp. */
export function parseDailyAt(value: string): { hour: number; minute: number } | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** True when watchPath has .. segments or a NUL — those escape the intended folder. */
export function watchPathEscapes(path: string): boolean {
  if (!path || path.includes("\0")) return true;
  return path.split(/[\\/]+/).some((part) => part === "..");
}

export function routineCreateError(input: {
  kind?: unknown;
  watchPath?: unknown;
  dailyAt?: unknown;
  webhookSecret?: unknown;
}): string | null {
  const kind = normalizeRoutineKind(input.kind);
  if (kind === "file") {
    const path = typeof input.watchPath === "string" ? input.watchPath.trim() : "";
    if (!path) return "watchPath required";
    if (watchPathEscapes(path)) return "watchPath must not contain ..";
  }
  if (kind === "webhook") {
    const secret = typeof input.webhookSecret === "string" ? input.webhookSecret.trim() : "";
    if (!secret) return "webhookSecret required";
  }
  if (input.dailyAt !== undefined && input.dailyAt !== null) {
    if (typeof input.dailyAt !== "string" || !parseDailyAt(input.dailyAt)) {
      return "dailyAt must be HH:MM";
    }
  }
  return null;
}

export function routineHookPath(id: string): string {
  return `/api/routines/hooks/${id}`;
}

export function listRoutines(botId?: string): Routine[] {
  const all = load();
  return botId ? all.filter((r) => r.botId === botId) : all;
}

/** Routine rows as any client may see them: the webhook secret is write-only.
 * A hasSecret flag replaces the value everywhere a routine leaves the harness
 * (HTTP responses and SSE broadcasts alike). */
export type PublicRoutine = Omit<Routine, "webhookSecret"> & { webhookSecret?: undefined; hasSecret?: boolean };

export function publicRoutine(routine: Routine): PublicRoutine {
  return { ...routine, webhookSecret: undefined, hasSecret: Boolean(routine.webhookSecret) };
}

export function publicRoutines(botId?: string): PublicRoutine[] {
  return listRoutines(botId).map(publicRoutine);
}

export function nextRunAfter(r: Omit<Routine, "id">, from = Date.now()): number {
  if (r.everyMinutes && r.everyMinutes > 0) {
    return from + r.everyMinutes * 60_000;
  }
  const m = (r.dailyAt ?? "08:00").match(/^(\d{1,2}):(\d{2})$/);
  const hour = m ? Math.min(23, Number(m[1])) : 8;
  const minute = m ? Math.min(59, Number(m[2])) : 0;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  if (r.weekdaysOnly) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

export function createRoutine(input: Omit<Routine, "id" | "nextRunAt" | "lastRunAt">): Routine {
  const all = load();
  const kind = input.kind ?? "cron";
  const row: Routine = {
    ...input,
    kind,
    id: newId(),
    nextRunAt: isCronRoutine({ kind }) ? nextRunAfter({ ...input, kind }) : undefined,
  };
  all.push(row);
  save(all);
  return row;
}

export function createRoutineFromTurn(input: {
  botId: string;
  name: string;
  prompt: string;
  dailyAt?: string;
  everyMinutes?: number;
  weekdaysOnly?: boolean;
  onComplete?: { targetBotId: string; messageTemplate?: string };
  maxTokens?: number;
}): Routine {
  return createRoutine({
    botId: input.botId,
    name: input.name,
    prompt: input.prompt,
    dailyAt: input.dailyAt ?? "08:00",
    everyMinutes: input.everyMinutes,
    weekdaysOnly: input.weekdaysOnly,
    onComplete: input.onComplete,
    maxTokens: input.maxTokens,
    enabled: true,
  });
}

export function patchRoutine(id: string, patch: Partial<Routine>): Routine | null {
  const all = load();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const next = { ...all[idx], ...patch, id };
  if (
    isCronRoutine(next) &&
    (patch.everyMinutes !== undefined ||
      patch.dailyAt !== undefined ||
      patch.weekdaysOnly !== undefined ||
      patch.enabled === true)
  ) {
    next.nextRunAt = nextRunAfter(next);
  }
  all[idx] = next;
  save(all);
  return next;
}

export function deleteRoutine(id: string): boolean {
  const all = load();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  save(next);
  return true;
}

/** Drop every routine for a bot (DELETE bot must not leave cron/hooks firing). */
export function deleteRoutinesForBot(botId: string): number {
  const all = load();
  const next = all.filter((r) => r.botId !== botId);
  const n = all.length - next.length;
  if (n) save(next);
  return n;
}

export function dueRoutines(now = Date.now()): Routine[] {
  return load().filter((r) => isCronRoutine(r) && r.enabled && (r.nextRunAt ?? 0) <= now);
}

export function markRan(id: string, now = Date.now()): Routine | null {
  const all = load();
  const row = all.find((r) => r.id === id);
  if (!row) return null;
  row.lastRunAt = now;
  if (isCronRoutine(row)) {
    row.nextRunAt = nextRunAfter(row, now);
  }
  save(all);
  return row;
}

export function routinesFileExists(): boolean {
  return existsSync(FILE) || loadRoutinesFromDb().length > 0;
}
