import { randomUUID } from "node:crypto";

/** A task is a bounded delegation graph. Every active bot gets the same
 * coordination capability while it owns the current task path. */
export const DEFAULT_TASK_MAX_HOPS = 4;
export const DEFAULT_TASK_MAX_MESSAGES = 24;

export interface TaskContext {
  id: string;
  rootBotId: string;
  path: string[];
  hops: number;
  maxHops: number;
  messages: number;
  maxMessages: number;
}

export interface TaskDelegation {
  parent: TaskContext;
  child: TaskContext;
}

export function createTaskContext(rootBotId: string): TaskContext {
  const root = rootBotId.trim();
  return {
    id: `task-${randomUUID()}`,
    rootBotId: root,
    path: [root],
    hops: 0,
    maxHops: DEFAULT_TASK_MAX_HOPS,
    messages: 0,
    maxMessages: DEFAULT_TASK_MAX_MESSAGES,
  };
}

/** Parse a task context received from a child process. The limits stay under
 * the server defaults so a bot cannot expand its own delegation budget. */
export function parseTaskContext(value: unknown): TaskContext | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const rootBotId = typeof row.rootBotId === "string" ? row.rootBotId.trim() : "";
  const path = Array.isArray(row.path) ? row.path.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
  const hops = integer(row.hops);
  const messages = integer(row.messages);
  const maxHops = integer(row.maxHops);
  const maxMessages = integer(row.maxMessages);
  if (!id || !rootBotId || !path.length || path[0] !== rootBotId) return null;
  if (hops < 0 || messages < 0 || maxHops < 1 || maxMessages < 1) return null;
  if (hops !== path.length - 1 || hops > maxHops || messages > maxMessages) return null;
  if (maxHops > DEFAULT_TASK_MAX_HOPS || maxMessages > DEFAULT_TASK_MAX_MESSAGES) return null;
  if (new Set(path).size !== path.length) return null;
  return { id, rootBotId, path, hops, maxHops, messages, maxMessages };
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : -1;
}

/** Authorize one delegation and return the updated parent cursor plus the
 * child cursor that the target turn must receive. */
export function delegateTask(context: TaskContext, fromBotId: string, targetBotId: string): TaskDelegation | { error: string } {
  const from = fromBotId.trim();
  const target = targetBotId.trim();
  if (!from || !target) return { error: "task delegation needs a sender and target" };
  if (context.path.at(-1) !== from) return { error: "bot is not the active owner of this task" };
  if (context.path.includes(target)) return { error: "task delegation would create a cycle" };
  if (context.hops >= context.maxHops) return { error: `task delegation limit reached (${context.maxHops} hops)` };
  if (context.messages >= context.maxMessages) return { error: `task message budget reached (${context.maxMessages} messages)` };

  const parent: TaskContext = { ...context, messages: context.messages + 1 };
  const child: TaskContext = {
    ...parent,
    path: [...context.path, target],
    hops: context.hops + 1,
  };
  return { parent, child };
}

export function isTaskDelegation(value: TaskDelegation | { error: string }): value is TaskDelegation {
  return "parent" in value && "child" in value;
}
