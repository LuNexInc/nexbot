import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";

export type StoredAgentMessage = {
  fromBotId?: string;
  message: string;
  depth: number;
  at: number;
};

const FILE = join(DATA_DIR, "agent-inbox.json");

export function loadAgentInbox(): Map<string, StoredAgentMessage[]> {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
    const entries = Object.entries(raw ?? {}).flatMap(([botId, value]) => {
      if (!Array.isArray(value)) return [];
      const messages = value.filter((row): row is StoredAgentMessage => {
        return Boolean(row && typeof row === "object" && typeof (row as any).message === "string");
      });
      return messages.length ? [[botId, messages] as const] : [];
    });
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function persistAgentInbox(inbox: Map<string, StoredAgentMessage[]>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const output: Record<string, StoredAgentMessage[]> = {};
  for (const [botId, messages] of inbox) {
    if (messages.length) output[botId] = messages;
  }
  writeFileSync(FILE, JSON.stringify(output, null, 2));
}
