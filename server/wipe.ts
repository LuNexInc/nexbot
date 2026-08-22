// Local data reset. Credentials, app settings, and custom skills stay intact.
import { existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, EVENTS_DIR, NATIVE_DIR } from "./config.ts";
import { openStoreDb, walCheckpoint } from "./db.ts";

export type WipeSummary = {
  bots: number;
  messages: number;
  routines: number;
  jobs: number;
  files: number;
};

function tableExists(table: string): boolean {
  const row = openStoreDb()
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { present?: number } | undefined;
  return row?.present === 1;
}

function countRows(table: string): number {
  if (!tableExists(table)) return 0;
  const row = openStoreDb().prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n?: number };
  return Number(row?.n ?? 0);
}

function removeChildren(dir: string): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    try {
      rmSync(join(dir, name), { recursive: true, force: true });
      removed += 1;
    } catch {
      // A provider can still hold a log briefly. The database remains the
      // source of truth, and the next wipe can remove a locked leftover.
    }
  }
  return removed;
}

function removeLegacyFiles(): number {
  let names: string[] = [];
  try {
    names = readdirSync(DATA_DIR);
  } catch {
    return 0;
  }
  const legacy = names.filter((name) =>
    /^(bots\.json|routines\.json|pending-turns\.json|agent-inbox\.json|messages-.+\.json)$/.test(name),
  );
  let removed = 0;
  for (const name of legacy) {
    try {
      unlinkSync(join(DATA_DIR, name));
      removed += 1;
    } catch {
      // Keep going so one locked legacy file does not block the reset.
    }
  }
  return removed;
}

/** Clear chat and bot state while preserving config.json, .env, and skills/. */
export function wipeLocalData(): WipeSummary {
  const db = openStoreDb();
  const summary: WipeSummary = {
    bots: countRows("bots"),
    messages: countRows("messages"),
    routines: countRows("routines"),
    jobs: countRows("jobs"),
    files: 0,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (tableExists("messages")) db.exec("DELETE FROM messages");
    if (tableExists("bots")) db.exec("DELETE FROM bots");
    if (tableExists("routines")) db.exec("DELETE FROM routines");
    if (tableExists("jobs")) db.exec("DELETE FROM jobs");
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('explicit_wipe', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
    ).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  summary.files += removeLegacyFiles();
  for (const dir of [join(DATA_DIR, "desk"), join(DATA_DIR, "memory"), EVENTS_DIR, NATIVE_DIR]) {
    summary.files += removeChildren(dir);
  }
  try {
    walCheckpoint();
  } catch {
    // A busy provider can delay the checkpoint. The rows are still deleted.
  }
  return summary;
}
