import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import { createTaskContext, parseTaskContext, type TaskContext } from "./task-context.ts";

export type StoredAgentMessage = {
  fromBotId?: string;
  message: string;
  taskContext: TaskContext;
  at: number;
};

const FILE = join(DATA_DIR, "agent-inbox.json");

export function loadAgentInbox(): Map<string, StoredAgentMessage[]> {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
    const entries = Object.entries(raw ?? {}).flatMap(([botId, value]) => {
      if (!Array.isArray(value)) return [];
      const messages = value.flatMap((row): StoredAgentMessage[] => {
        if (!row || typeof row !== "object" || typeof (row as any).message !== "string") return [];
        const taskContext = parseTaskContext((row as any).taskContext) ?? createTaskContext(botId);
        return [{
          fromBotId: typeof (row as any).fromBotId === "string" ? (row as any).fromBotId : undefined,
          message: String((row as any).message),
          taskContext,
          at: typeof (row as any).at === "number" ? (row as any).at : Date.now(),
        }];
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
