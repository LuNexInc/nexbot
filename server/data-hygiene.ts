// One-shot cleanup of leftover data-dir files after the SQLite migration.
// store.db is the live store. data.sqlite is unused. messages-*.json is
// imported once, then stale.
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { jsonImportDone, walCheckpoint, type WalCheckpoint } from "./db.ts";

const DEAD_SQLITE = ["data.sqlite", "data.sqlite-wal", "data.sqlite-shm"];

export function sweepLegacyDataFiles(): string[] {
  const removed: string[] = [];
  for (const name of DEAD_SQLITE) {
    const file = join(DATA_DIR, name);
    if (!existsSync(file)) continue;
    try {
      unlinkSync(file);
      removed.push(name);
    } catch {
      /* file in use */
    }
  }
  if (!jsonImportDone()) return removed;
  let names: string[] = [];
  try {
    names = readdirSync(DATA_DIR);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!/^messages-.+\.json$/.test(name)) continue;
    try {
      unlinkSync(join(DATA_DIR, name));
      removed.push(name);
    } catch {
      /* file in use */
    }
  }
  return removed;
}

export function runDataHygiene(): { removed: string[]; checkpoint: WalCheckpoint | null } {
  const removed = sweepLegacyDataFiles();
  let checkpoint: WalCheckpoint | null = null;
  try {
    checkpoint = walCheckpoint();
  } catch {
    checkpoint = null;
  }
  return { removed, checkpoint };
}
