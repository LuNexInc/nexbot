import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeStoreDb, dbExists, importJsonIfNeeded, integrityCheck, openStoreDb, searchMessages, walCheckpoint } from "./db.ts";
import { Store } from "./store.ts";
import type { ModelSelection } from "./contracts.ts";
import { rmSync } from "node:fs";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

beforeEach(() => {
  closeStoreDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
});
afterEach(() => { closeStoreDb(); });

describe("sqlite import + search", () => {
  it("opens WAL and FTS5 unicode61", () => {
    const db = openStoreDb();
    const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(String(mode.journal_mode).toLowerCase()).toBe("wal");
    const fts = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get("messages_fts") as { sql: string };
    expect(String(fts.sql).toLowerCase()).toContain("unicode61");
    expect(dbExists()).toBe(true);
  });

  it("imports existing bots.json, messages-*.json, and routines.json on first start", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    const bot = { id: "b1", threadId: "t1", name: "Research", title: "Research", description: "", notifications: true, color: "blue", unread: false, modelSelection: selection(), resumeCursors: {}, createdAt: 1 };
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify([bot]));
    writeFileSync(join(DATA_DIR, "messages-t1.json"), JSON.stringify([{ id: "m1", role: "user", kind: "text", text: "find cafe sources", at: 2 }]));
    writeFileSync(join(DATA_DIR, "routines.json"), JSON.stringify([{ id: "r1", botId: "b1", name: "digest", prompt: "p", enabled: true }]));
    const imported = importJsonIfNeeded();
    expect(imported.bots).toBe(1);
    expect(imported.messages).toBe(1);
    expect(imported.routines).toBe(1);
    const store = new Store(selection);
    expect(store.bot("b1")?.name).toBe("Research");
    expect(store.messagesFor("t1")[0].text).toBe("find cafe sources");
    expect(importJsonIfNeeded().bots).toBe(0);
  });

  it("FTS5 search finds imported text and ignores unrelated", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Research" });
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "summarize the cafe brief" });
    store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "unrelated weather note" });
    const hits = searchMessages("cafe");
    expect(hits.some((h) => h.text.includes("cafe"))).toBe(true);
    expect(searchMessages("xyzzy-no-such")).toEqual([]);
  });
  it("FTS5 search handles special characters, operators, and malformed queries safely", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Research" });
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Bloominary Google Forms reminder" });
    
    // Prefix matching
    expect(searchMessages("Bloom").length).toBe(1);
    expect(searchMessages("Bloominary").length).toBe(1);
    
    // Special chars and FTS operators shouldn't throw
    expect(searchMessages('"""""').length).toBe(0);
    expect(searchMessages('AND OR NOT').length).toBe(0);
    expect(searchMessages('Forms (reminder) * ^ ~').length).toBe(1);
    expect(searchMessages('   ').length).toBe(0);
  });

  it("integrity_check is ok and WAL checkpoint runs", () => {
    openStoreDb();
    expect(integrityCheck()).toBe("ok");
    const ck = walCheckpoint();
    expect(ck.busy).toBe(0);
  });
});
