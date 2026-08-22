// Per-bot desk folder + optional memory. Lives under ~/.nexbot.
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { DATA_DIR } from "./config.ts";

export const DESK_ROOT = join(DATA_DIR, "desk");
export const MEMORY_ROOT = join(DATA_DIR, "memory");
/** PUT /memory refuses a profile or month log bigger than this. */
export const MEMORY_FILE_MAX = 16_384;
/** Injected prompt clip — log already used 8k; profile must too. */
export const MEMORY_PROMPT_CLIP = 8_000;

export function deskPath(botId: string): string {
  return join(DESK_ROOT, botId);
}

export function inboxPath(botId: string): string {
  return join(deskPath(botId), "inbox");
}

export function memoryDir(botId: string): string {
  return join(MEMORY_ROOT, botId);
}

export function profilePath(botId: string): string {
  return join(memoryDir(botId), "profile.md");
}

export function logPath(botId: string, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return join(memoryDir(botId), "log", `${y}-${m}.md`);
}

function legacyMemoryFile(botId: string): string {
  return join(MEMORY_ROOT, `${botId}.md`);
}

export function ensureMemory(botId: string): string {
  const dir = memoryDir(botId);
  mkdirSync(join(dir, "log"), { recursive: true });
  const oldFile = legacyMemoryFile(botId);
  if (existsSync(oldFile)) {
    try {
      const st = lstatSync(oldFile);
      if (st.isDirectory()) {
        // already a directory; leave it
      } else if (st.isFile()) {
        const contents = readFileSync(oldFile, "utf8");
        writeFileSync(profilePath(botId), contents);
        unlinkSync(oldFile);
      }
    } catch {
      /* ignore a raced or unreadable leftover */
    }
  }
  return dir;
}

export function ensureDesk(botId: string): string {
  const dir = deskPath(botId);
  mkdirSync(join(dir, "inbox"), { recursive: true });
  mkdirSync(join(dir, "out"), { recursive: true });
  ensureMemory(botId);
  return dir;
}

export function readProfile(botId: string): string {
  try {
    return readFileSync(profilePath(botId), "utf8");
  } catch {
    return "";
  }
}

export function writeProfile(botId: string, text: string): void {
  ensureMemory(botId);
  writeFileSync(profilePath(botId), text);
}

export function readLog(botId: string, date = new Date()): string {
  try {
    return readFileSync(logPath(botId, date), "utf8");
  } catch {
    return "";
  }
}

export function writeLog(botId: string, text: string, date = new Date()): void {
  ensureMemory(botId);
  writeFileSync(logPath(botId, date), text);
}

export function appendLog(botId: string, text: string, date = new Date()): void {
  ensureMemory(botId);
  appendFileSync(logPath(botId, date), text);
}

/** Compat: profile + current month log. */
export function readMemory(botId: string): string {
  const profile = readProfile(botId);
  const log = readLog(botId);
  if (profile && log) return `${profile}\n\n${log}`;
  return profile || log;
}

/** Compat: writes PROFILE only (old PUT { text }). */
export function writeMemory(botId: string, text: string): void {
  writeProfile(botId, text);
}

export function writeInboxFile(botId: string, name: string, data: Buffer): string {
  ensureDesk(botId);
  const safe = basename(name).replace(/[<>:"|?*]/g, "_") || "file";
  const dest = join(inboxPath(botId), safe);
  writeFileSync(dest, data);
  return dest;
}

export function memoryPrompt(botId: string): string {
  let profile = readProfile(botId).trim();
  let log = readLog(botId).trim();
  if (!profile && !log) return "";
  if (profile.length > MEMORY_PROMPT_CLIP) profile = profile.slice(0, MEMORY_PROMPT_CLIP);
  if (log.length > MEMORY_PROMPT_CLIP) log = log.slice(-MEMORY_PROMPT_CLIP);
  const profileFile = profilePath(botId);
  const monthFile = logPath(botId);
  return ` Durable facts live in ${profileFile} (kept every turn). Dated notes live in ${monthFile}. You may update those files when memory is enabled.\n\nprofile.md:\n${profile || "(empty)"}\n\n${basename(monthFile)}:\n${log || "(empty)"}`;
}

export function deskPrompt(botId: string): string {
  const dir = ensureDesk(botId);
  return ` Your desk folder is ${dir} (inbox/ for incoming files, out/ for results). Prefer reading and writing there.`;
}

export function existsMemory(botId: string): boolean {
  if (existsSync(profilePath(botId))) return true;
  const oldFile = legacyMemoryFile(botId);
  try {
    if (existsSync(oldFile) && lstatSync(oldFile).isFile()) return true;
  } catch {}
  try {
    const logs = readdirSync(join(memoryDir(botId), "log"));
    if (logs.some((f) => f.endsWith(".md"))) return true;
  } catch {}
  return false;
}

/** System-prompt prefix for a turn. `memory` is already the memoryPrompt
 * string (or "") — callers pass it only when memoryEnabled is true. */
export function buildPersona(
  bot: { name: string; title?: string; description?: string; personality?: string },
  parts: { desk: string; memory: string; skills: string },
): string {
  const memoryRecallStyle =
    "When these notes shape your answer, weave the recall naturally into your own voice (\"I remember you said…\", \"that connects to last week's decision\") so it reads like a colleague who remembers — never mention profile.md, day-log files, note headings, or note formats.";
  return [
    `You are ${bot.name}, a personal bot in NexBot.`,
    bot.title && `Role: ${bot.title}.`,
    bot.description && `About: ${bot.description}`,
    bot.personality && `Talking style:\n${bot.personality}`,
    parts.desk,
    parts.memory && `${parts.memory} ${memoryRecallStyle}`,
    parts.skills,
  ]
    .filter(Boolean)
    .join(" ");
}
