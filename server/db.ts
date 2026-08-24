// SQLite WAL store. better-sqlite3 when installed; node:sqlite (Node 24 / Electron) otherwise.
// FTS5 unicode61. Packaged app has no node_modules — node:sqlite is the Windows electron-builder path.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.ts";
import type { Routine } from "./routines.ts";
import type { BotRecord, Message } from "./store.ts";

export const dbFile = (): string => join(DATA_DIR, "store.db");

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, bot_id TEXT, at INTEGER NOT NULL, text TEXT NOT NULL DEFAULT "", json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_thread_at ON messages(thread_id, at);
CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, bot_id TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_bot_status ON jobs(bot_id, status);
CREATE TABLE IF NOT EXISTS execution_receipts (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, job_id TEXT, item_id TEXT, action TEXT NOT NULL, status TEXT NOT NULL, verification TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS execution_receipts_bot_started ON execution_receipts(bot_id, started_at DESC);
CREATE INDEX IF NOT EXISTS execution_receipts_job ON execution_receipts(job_id, started_at);
CREATE TABLE IF NOT EXISTS queued_turns (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS queued_turns_bot_priority ON queued_turns(bot_id, priority DESC, created_at ASC);
CREATE TABLE IF NOT EXISTS memory_facts (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, fact TEXT NOT NULL, valid_from INTEGER, valid_until INTEGER, created_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS memory_facts_bot_created ON memory_facts(bot_id, created_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(fact, content='memory_facts', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS memory_facts_ai AFTER INSERT ON memory_facts BEGIN INSERT INTO memory_facts_fts(rowid, fact) VALUES (new.rowid, new.fact); END;
CREATE TRIGGER IF NOT EXISTS memory_facts_ad AFTER DELETE ON memory_facts BEGIN INSERT INTO memory_facts_fts(memory_facts_fts, rowid, fact) VALUES('delete', old.rowid, old.fact); END;
CREATE TRIGGER IF NOT EXISTS memory_facts_au AFTER UPDATE ON memory_facts BEGIN INSERT INTO memory_facts_fts(memory_facts_fts, rowid, fact) VALUES('delete', old.rowid, old.fact); INSERT INTO memory_facts_fts(rowid, fact) VALUES (new.rowid, new.fact); END;
CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, label TEXT NOT NULL, env_name TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credential_grants (credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (credential_id, bot_id));
CREATE INDEX IF NOT EXISTS credential_grants_bot ON credential_grants(bot_id);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text); END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text); END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text); INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text); END;
`;
type Cache = { path: string; db: DatabaseSync };
let cache: Cache | null = null;

export function closeStoreDb(): void {
  if (!cache) return;
  try { cache.db.close(); } catch { /* already closed */ }
  cache = null;
}

function wal(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
}

export function openStoreDb(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const path = dbFile();
  if (cache && cache.path === path) {
    try { cache.db.prepare("SELECT 1").get(); return cache.db; } catch { closeStoreDb(); }
  } else if (cache) { closeStoreDb(); }
  const db = new DatabaseSync(path);
  wal(db);
  db.exec(SCHEMA);
  runMigrations(db);
  cache = { path, db };
  return db;
}

/** Versioned schema steps beyond the idempotent CREATE TABLE baseline.
 * Add one entry per release that changes shape; never edit a shipped step. */
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [
  // v1: baseline — every workspace that predates the runner is already on it.
];

function runMigrations(db: DatabaseSync): void {
  const from = Number((db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0);
  if (from >= MIGRATIONS.length) return;
  for (let v = from; v < MIGRATIONS.length; v++) {
    const step = MIGRATIONS[v];
    db.exec("BEGIN");
    try {
      step(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`store.db migration to v${v + 1} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
}

function parseJsonArray(raw: string): unknown[] {
  try { const data = JSON.parse(raw); return Array.isArray(data) ? data : []; } catch { return []; }
}

function ftsText(m: Message): string {
  if (m.kind === "screen") return "";
  return (m.text ?? "").trim();
}

function messageJson(m: Message): string {
  // Screens are useful in the live client, but their base64 payloads make
  // every transcript write expensive. The existing full-thread persistence
  // already omits them, so keep the fast path consistent with it.
  return JSON.stringify(m.kind === "screen" ? { ...m, png: undefined } : m);
}

/** Append one message without deleting and re-inserting the whole thread. */
export function appendMessage(threadId: string, message: Message, botId?: string): void {
  const db = openStoreDb();
  db.prepare(
    "INSERT INTO messages (id, thread_id, bot_id, at, text, json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(message.id, threadId, botId ?? null, message.at, ftsText(message), messageJson(message));
}

/** Update one message without rewriting older transcript rows. */
export function patchMessage(threadId: string, message: Message): void {
  const db = openStoreDb();
  db.prepare("UPDATE messages SET at = ?, text = ?, json = ? WHERE id = ? AND thread_id = ?").run(
    message.at,
    ftsText(message),
    messageJson(message),
    message.id,
    threadId,
  );
}

export function persistBots(bots: BotRecord[]): void {
  const db = openStoreDb();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM bots");
    const ins = db.prepare("INSERT INTO bots (id, json) VALUES (?, ?)");
    for (const b of bots) ins.run(b.id, JSON.stringify(b));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

/** Upsert one bot row. patchBot fires per token-usage tick, so it must never
 * rewrite the whole table the way the import path does. */
export function persistBot(bot: BotRecord): void {
  openStoreDb()
    .prepare("INSERT INTO bots (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
    .run(bot.id, JSON.stringify(bot));
}

export function persistMessages(threadId: string, messages: Message[], botId?: string): void {
  const db = openStoreDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
    const ins = db.prepare("INSERT INTO messages (id, thread_id, bot_id, at, text, json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const m of messages) {
      ins.run(m.id, threadId, botId ?? null, m.at, ftsText(m), messageJson(m));
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function persistRoutines(routines: Routine[]): void {
  const db = openStoreDb();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM routines");
    const ins = db.prepare("INSERT INTO routines (id, bot_id, json) VALUES (?, ?, ?)");
    for (const r of routines) ins.run(r.id, r.botId, JSON.stringify(r));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function deleteThread(threadId: string): void {
  openStoreDb().prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
}

export function deleteBotRow(id: string): void {
  openStoreDb().prepare("DELETE FROM bots WHERE id = ?").run(id);
}

/** A row that cannot be parsed is a data-loss event, not a silent skip:
 * for a commercial workspace the operator must be able to see it happened. */
function warnSkippedRow(table: string, at: string): void {
  console.warn(`[store] skipped an unreadable ${table} row (${at}) — the record was left in the database`);
}

export function loadRoutinesFromDb(): Routine[] {
  const rows = openStoreDb().prepare("SELECT id, json FROM routines").all() as Array<{ id: string; json: string }>;
  const out: Routine[] = [];
  for (const row of rows) {
    try { out.push(JSON.parse(row.json) as Routine); } catch { warnSkippedRow("routines", row.id); }
  }
  return out;
}

export function loadBotsFromDb(): BotRecord[] {
  const rows = openStoreDb().prepare("SELECT id, json FROM bots").all() as Array<{ id: string; json: string }>;
  const out: BotRecord[] = [];
  for (const row of rows) { try { out.push(JSON.parse(row.json) as BotRecord); } catch { warnSkippedRow("bots", row.id); } }
  return out;
}

export function loadMessagesFromDb(): Map<string, Message[]> {
  const rows = openStoreDb().prepare("SELECT thread_id, json FROM messages ORDER BY at ASC").all() as Array<{ thread_id: string; json: string }>;
  const map = new Map<string, Message[]>();
  for (const row of rows) {
    try {
      const msg = JSON.parse(row.json) as Message;
      const list = map.get(row.thread_id) ?? [];
      list.push(msg);
      map.set(row.thread_id, list);
    } catch { warnSkippedRow("messages", row.thread_id); }
  }
  return map;
}

/** One thread's transcript, oldest first. Backs the store's lazy per-thread cache. */
export function loadThreadMessagesFromDb(threadId: string): Message[] {
  const rows = openStoreDb()
    .prepare("SELECT json FROM messages WHERE thread_id = ? ORDER BY at ASC")
    .all(threadId) as Array<{ json: string }>;
  const out: Message[] = [];
  let index = 0;
  for (const row of rows) {
    try { out.push(JSON.parse(row.json) as Message); } catch { warnSkippedRow("messages", `${threadId}#${index}`); }
    index += 1;
  }
  return out;
}

export type SearchHit = { messageId: string; threadId: string; botId: string | null; text: string; at: number };

export function ftsMatchQuery(q: string): string | null {
  const sanitized = q.replace(/["*^~:(){}[\]\\]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = sanitized.split(/\s+/).filter(Boolean).slice(0, 12);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

export function searchMessages(q: string, limit = 50): SearchHit[] {
  const match = ftsMatchQuery(q);
  if (!match) return [];
  try {
    const safeLimit = Math.min(100, Math.max(1, limit));
    const rows = openStoreDb().prepare(`SELECT m.id AS messageId, m.thread_id AS threadId, m.bot_id AS botId, m.text AS text, m.at AS at FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ? LIMIT ?`).all(match, safeLimit) as Array<{ messageId: string; threadId: string; botId: string | null; text: string; at: number }>;
    return rows.map((r) => ({ messageId: r.messageId, threadId: r.threadId, botId: r.botId, text: r.text, at: r.at }));
  } catch {
    return [];
  }
}
function metaGet(key: string): string | null {
  const row = openStoreDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function metaSet(key: string, value: string): void {
  openStoreDb().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function wasExplicitlyWiped(): boolean {
  return metaGet("explicit_wipe") === "1";
}

export function clearExplicitWipeMarker(): void {
  openStoreDb().prepare("DELETE FROM meta WHERE key = 'explicit_wipe'").run();
}
function importBotsJson(): BotRecord[] {
  try { const data = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")); return Array.isArray(data) ? (data as BotRecord[]) : []; } catch { return []; }
}
function importMessageFiles(): Map<string, Message[]> {
  const map = new Map<string, Message[]>();
  let names: string[];
  try { names = readdirSync(DATA_DIR); } catch { return map; }
  for (const name of names) {
    const m = name.match(/^messages-(.+)\.json$/);
    if (!m) continue;
    try {
      const list = parseJsonArray(readFileSync(join(DATA_DIR, name), "utf8")) as Message[];
      map.set(m[1], list.filter((row) => row && typeof row === "object" && typeof row.id === "string"));
    } catch { /* skip */ }
  }
  return map;
}
function importRoutinesJson(): Routine[] {
  try { const data = JSON.parse(readFileSync(join(DATA_DIR, "routines.json"), "utf8")); return Array.isArray(data) ? (data as Routine[]) : []; } catch { return []; }
}

export function jsonImportDone(): boolean {
  openStoreDb();
  return metaGet("imported_json") === "1";
}

export function importJsonIfNeeded(): { bots: number; messages: number; routines: number } {
  openStoreDb();
  if (jsonImportDone()) return { bots: 0, messages: 0, routines: 0 };
  const existing = openStoreDb().prepare("SELECT COUNT(*) AS n FROM bots").get() as { n: number };
  if (existing.n > 0) { metaSet("imported_json", "1"); return { bots: 0, messages: 0, routines: 0 }; }
  const bots = importBotsJson();
  const threads = importMessageFiles();
  const routines = importRoutinesJson();
  if (bots.length) persistBots(bots);
  let messageCount = 0;
  const botByThread = new Map(bots.map((b) => [b.threadId, b.id]));
  for (const [threadId, list] of threads) { persistMessages(threadId, list, botByThread.get(threadId)); messageCount += list.length; }
  if (routines.length) persistRoutines(routines);
  metaSet("imported_json", "1");
  return { bots: bots.length, messages: messageCount, routines: routines.length };
}

export function dbExists(): boolean { return existsSync(dbFile()); }

export function integrityCheck(): string {
  const row = openStoreDb().prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
  return String(row?.integrity_check ?? "unknown");
}

export type WalCheckpoint = { busy: number; log: number; checkpointed: number };

export function walCheckpoint(): WalCheckpoint {
  const row = openStoreDb().prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as WalCheckpoint | undefined;
  return {
    busy: Number(row?.busy ?? 0),
    log: Number(row?.log ?? 0),
    checkpointed: Number(row?.checkpointed ?? 0),
  };
}
