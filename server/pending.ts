// Interrupted turns survive a crash or reboot. Cleared when the turn ends.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";

export type PendingTurn = {
  botId: string;
  text: string;
  at: number;
  kind: "user" | "routine";
};

const FILE = join(DATA_DIR, "pending-turns.json");

function load(): PendingTurn[] {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(list: PendingTurn[]) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export function rememberTurn(botId: string, text: string, kind: PendingTurn["kind"] = "user") {
  const list = load().filter((p) => p.botId !== botId);
  list.push({ botId, text, at: Date.now(), kind });
  save(list);
}

export function forgetTurn(botId: string) {
  save(load().filter((p) => p.botId !== botId));
}

export function listPending(): PendingTurn[] {
  return load();
}
