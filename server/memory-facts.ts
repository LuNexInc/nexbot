import { newId } from "./contracts.ts";
import { ftsMatchQuery, openStoreDb } from "./db.ts";

export type MemorySourceType = "user" | "assistant" | "tool" | "import" | "system";
export interface MemoryFact {
  id: string;
  botId: string;
  fact: string;
  kind: "fact" | "preference" | "event" | "procedure";
  sourceType: MemorySourceType;
  sourceId: string;
  sourceAt: number;
  validFrom?: number;
  validUntil?: number;
  confidence: number;
  createdAt: number;
}
export function saveMemoryFact(input: Omit<MemoryFact, "id" | "createdAt">): MemoryFact {
  const row: MemoryFact = {
    ...input,
    id: newId(),
    fact: input.fact.trim().slice(0, 8_000),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    createdAt: Date.now(),
  };
  openStoreDb().prepare(
    "INSERT INTO memory_facts (id, bot_id, fact, valid_from, valid_until, created_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.botId, row.fact, row.validFrom ?? null, row.validUntil ?? null, row.createdAt, JSON.stringify(row));
  return row;
}

export function listMemoryFacts(botId: string, now = Date.now(), limit = 100): MemoryFact[] {
  const rows = openStoreDb().prepare(
    `SELECT json FROM memory_facts
     WHERE bot_id = ? AND (valid_from IS NULL OR valid_from <= ?) AND (valid_until IS NULL OR valid_until >= ?)
     ORDER BY created_at DESC LIMIT ?`,
  ).all(botId, now, now, Math.min(500, Math.max(1, limit))) as Array<{ json: string }>;
  return rows.flatMap((row) => { try { return [JSON.parse(row.json) as MemoryFact]; } catch { return []; } });
}

export function searchMemoryFacts(query: string, options: { botId?: string; now?: number; limit?: number } = {}): MemoryFact[] {
  const match = ftsMatchQuery(query);
  if (!match) return [];
  const now = options.now ?? Date.now();
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const botClause = options.botId ? "AND m.bot_id = ?" : "";
  const args = options.botId ? [match, now, now, options.botId, limit] : [match, now, now, limit];
  try {
    const rows = openStoreDb().prepare(
      `SELECT m.json FROM memory_facts_fts f JOIN memory_facts m ON m.rowid = f.rowid
       WHERE memory_facts_fts MATCH ?
         AND (m.valid_from IS NULL OR m.valid_from <= ?)
         AND (m.valid_until IS NULL OR m.valid_until >= ?)
         ${botClause}
       ORDER BY bm25(memory_facts_fts), m.created_at DESC LIMIT ?`,
    ).all(...args) as Array<{ json: string }>;
    return rows.flatMap((row) => { try { return [JSON.parse(row.json) as MemoryFact]; } catch { return []; } });
  } catch { return []; }
}

export function memoryFactsPrompt(botId: string): string {
  const facts = listMemoryFacts(botId, Date.now(), 24);
  if (!facts.length) return "";
  return `\n\nStructured memory facts (use the source and date when resolving conflicts):\n${facts.map((f) =>
    `- ${f.fact} [source=${f.sourceType}:${f.sourceId}; observed=${new Date(f.sourceAt).toISOString()}; confidence=${f.confidence.toFixed(2)}${f.validUntil ? `; valid-until=${new Date(f.validUntil).toISOString()}` : ""}]`,
  ).join("\n")}`;
}
