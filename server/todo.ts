// Durable per-bot checklists. In-memory, synced to
// ~/.nexbot/desk/<bot-id>/todos.json. The todo MCP tool (this file as main)
// lets specialists keep a live plan; the harness owns apply + SSE.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { deskPath, ensureDesk } from "./desk.ts";

export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoInput {
  id?: string;
  content?: string;
  status?: string;
}

/** Legal next statuses. cancelled only reopens to pending. */
export const TODO_TRANSITIONS: Record<TodoStatus, readonly TodoStatus[]> = {
  pending: ["pending", "in_progress", "completed", "cancelled"],
  in_progress: ["in_progress", "pending", "completed", "cancelled"],
  completed: ["completed", "pending", "in_progress", "cancelled"],
  cancelled: ["cancelled", "pending"],
};

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: TodoStatus, to: TodoStatus): boolean {
  return TODO_TRANSITIONS[from].includes(to);
}

export function todosPath(botId: string): string {
  const safe = basename(botId).replace(/[<>:"|?*]/g, "_") || "bot";
  return join(deskPath(safe), "todos.json");
}

const cache = new Map<string, TodoItem[]>();
const listeners = new Set<(botId: string, items: TodoItem[]) => void>();

export function onTodosChange(fn: (botId: string, items: TodoItem[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitChange(botId: string, items: TodoItem[]): void {
  for (const fn of [...listeners]) fn(botId, items);
}

function clone(items: TodoItem[]): TodoItem[] {
  return items.map((t) => ({ ...t }));
}

function parseFile(raw: string): TodoItem[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : (data as { items?: unknown })?.items;
  if (!Array.isArray(list)) return [];
  const out: TodoItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
    const content = typeof o.content === "string" ? o.content.trim() : "";
    if (!id || !content || !isTodoStatus(o.status)) continue;
    out.push({ id, content, status: o.status });
  }
  return out;
}

function readDisk(botId: string): TodoItem[] {
  try {
    return parseFile(readFileSync(todosPath(botId), "utf8"));
  } catch {
    return [];
  }
}

function writeDisk(botId: string, items: TodoItem[]): void {
  ensureDesk(botId);
  writeFileSync(
    todosPath(botId),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2),
  );
}

/** Load from memory, falling back to ~/.nexbot/desk/<bot-id>/todos.json. */
export function listTodos(botId: string): TodoItem[] {
  const hit = cache.get(botId);
  if (hit) return clone(hit);
  const items = readDisk(botId);
  cache.set(botId, items);
  return clone(items);
}

/** Test helper: drop the in-memory map so the next listTodos hits disk. */
export function resetTodoCache(botId?: string): void {
  if (botId) cache.delete(botId);
  else cache.clear();
}

let seq = 0;
function newTodoId(): string {
  seq += 1;
  return `td-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function enforceOneInProgress(items: TodoItem[]): TodoItem[] {
  let seen = false;
  const out: TodoItem[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.status === "in_progress") {
      if (seen) out.push({ ...item, status: "pending" });
      else {
        seen = true;
        out.push(item);
      }
    } else out.push(item);
  }
  return out.reverse();
}

export class TodoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoError";
  }
}

function normalizeInput(raw: TodoInput, existing?: TodoItem): TodoItem {
  const content = (raw.content ?? existing?.content ?? "").trim();
  if (!content) throw new TodoError("todo content is required");
  const status = isTodoStatus(raw.status) ? raw.status : (existing?.status ?? "pending");
  const id = (raw.id ?? existing?.id ?? "").trim() || newTodoId();
  if (existing && raw.status && isTodoStatus(raw.status) && !canTransition(existing.status, raw.status)) {
    throw new TodoError(`cannot move ${id} from ${existing.status} to ${raw.status}`);
  }
  if (!existing && raw.status && !isTodoStatus(raw.status)) {
    throw new TodoError(`invalid status: ${String(raw.status)}`);
  }
  return { id, content, status };
}

/** Replace the checklist. Existing ids must follow the state machine. */
export function replaceTodos(botId: string, inputs: TodoInput[]): TodoItem[] {
  const prev = listTodos(botId);
  const byId = new Map(prev.map((t) => [t.id, t]));
  const used = new Set<string>();
  const next: TodoItem[] = [];
  for (const raw of inputs) {
    const existing = raw.id && byId.has(raw.id) ? byId.get(raw.id) : undefined;
    const item = normalizeInput(raw, existing);
    if (used.has(item.id)) throw new TodoError(`duplicate todo id: ${item.id}`);
    used.add(item.id);
    next.push(item);
  }
  const items = enforceOneInProgress(next);
  cache.set(botId, items);
  writeDisk(botId, items);
  emitChange(botId, clone(items));
  return clone(items);
}

export function formatTodoList(items: TodoItem[]): string {
  if (!items.length) return "Checklist is empty.";
  const mark = (s: TodoStatus) =>
    s === "completed" ? "[x]" : s === "cancelled" ? "[-]" : s === "in_progress" ? "[>]" : "[ ]";
  return items.map((t) => `${mark(t.status)} ${t.id} ${t.content} (${t.status})`).join("\n");
}

export const TODO_TOOL = {
  name: "todo",
  description:
    "Durable checklist for this bot's current job. Call with no items to list. Call with items to replace the list (reuse ids when updating). Statuses: pending, in_progress, completed, cancelled. Keep exactly one item in_progress while you work. Cancelled items only reopen to pending.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Replace the checklist with these items. Omit to only list.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Existing id to update; omit to create." },
            content: { type: "string", description: "What to do." },
            status: {
              type: "string",
              enum: [...TODO_STATUSES],
              description: "pending | in_progress | completed | cancelled",
            },
          },
          required: ["content", "status"],
        },
      },
    },
  },
} as const;

export const TODO_OPENAI_TOOL = {
  type: "function" as const,
  function: {
    name: TODO_TOOL.name,
    description: TODO_TOOL.description,
    parameters: TODO_TOOL.inputSchema,
  },
};

export function applyTodoTool(
  botId: string,
  args: { items?: TodoInput[] } | null | undefined,
): { text: string; items: TodoItem[]; isError?: boolean } {
  if (!botId) return { text: "todo needs a bot id.", items: [], isError: true };
  const itemsArg = args?.items;
  if (itemsArg === undefined) {
    const items = listTodos(botId);
    return { text: formatTodoList(items), items };
  }
  if (!Array.isArray(itemsArg)) {
    return { text: "todo items must be an array.", items: listTodos(botId), isError: true };
  }
  try {
    const items = replaceTodos(botId, itemsArg);
    return { text: formatTodoList(items), items };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), items: listTodos(botId), isError: true };
  }
}

// ── MCP stdio (spawned as the todos integration) ───────────────────────
type Json = Record<string, unknown>;

function runningAsMain(): boolean {
  try {
    const self = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? resolve(process.argv[1]) : "";
    return Boolean(argv1) && (self === argv1 || basename(argv1).startsWith("todo."));
  } catch {
    return false;
  }
}

function startTodoMcp(): void {
  const HARNESS = process.env.NEXBOT_HARNESS_URL ?? "http://127.0.0.1:8799";
  const BOT_ID = process.env.NEXBOT_BOT_ID ?? "";
  const TOKEN = process.env.NEXBOT_COMMS_TOKEN ?? "";
  const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
  const rpcErr = (id: unknown, code: number, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });
  const textResult = (id: unknown, text: string, isError = false) =>
    ok(id, { content: [{ type: "text", text }], isError });

  async function callTool(name: string, args: Json): Promise<{ text: string; isError?: boolean }> {
    if (name !== "todo") return { text: `Unknown tool: ${name}`, isError: true };
    const res = await fetch(HARNESS + "/api/internal/todos", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ botId: BOT_ID, items: args.items }),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) return { text: String(body.error ?? `HTTP ${res.status}`), isError: true };
    return { text: String(body.text ?? ""), isError: Boolean(body.isError) };
  }

  async function handle(msg: Json) {
    const id = msg.id;
    const method = msg.method as string | undefined;
    if (!method) return;
    const params = (msg.params ?? {}) as Json;
    switch (method) {
      case "initialize":
        ok(id, {
          protocolVersion: (params.protocolVersion as string) ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "nexbot-todos", version: "0.1.0" },
        });
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        ok(id, {});
        return;
      case "tools/list":
        ok(id, { tools: [TODO_TOOL] });
        return;
      case "tools/call": {
        const name = params.name as string;
        if (name !== "todo") return rpcErr(id, -32602, `Unknown tool: ${name}`);
        try {
          const { text, isError } = await callTool(name, (params.arguments ?? {}) as Json);
          textResult(id, text, isError);
        } catch (e) {
          textResult(id, (e as Error).message, true);
        }
        return;
      }
      default:
        if (id !== undefined) rpcErr(id, -32601, `Method not found: ${method}`);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    let msg: Json;
    try {
      msg = JSON.parse(t) as Json;
    } catch {
      return;
    }
    void handle(msg).catch((e) => {
      if (msg.id !== undefined) rpcErr(msg.id, -32603, (e as Error).message);
    });
  });
  rl.on("close", () => process.exit(0));
}

if (runningAsMain()) startTodoMcp();
