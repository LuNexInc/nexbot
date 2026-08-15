// Agent-to-agent comms MCP proxy — spawned as an MCP server inside a bot's
// agent process (via the "agents" integration). Exposes two tools that let
// one bot talk to another, routed back through the harness so the harness
// stays the single owner of turns, permissions, and recursion limits:
//
//   list_bots()            → the other bots in this workspace + their status
//   ask_bot(bot_id, msg)   → send msg to that bot, wait, return its reply
//   send_bot(bot_id, msg)  → queue msg and return immediately
//
// Speaks raw JSON-RPC 2.0 over stdio (no MCP SDK — house style, matches
// computer-proxy / permission-proxy). All state comes from env, injected by
// the harness when it builds the integration:
//   NEXBOT_HARNESS_URL  base URL of the harness (http://127.0.0.1:8799)
//   NEXBOT_BOT_ID       the calling bot's id (excluded from list_bots; sender)
//   NEXBOT_COMMS_TOKEN  shared secret for the localhost-only internal endpoints
//   NEXBOT_TASK_CONTEXT serialized task scope and delegation budget
import readline from "node:readline";
import { ASK_BOT_HTTP_TIMEOUT_MS, ASK_BOT_STILL_WORKING } from "../comms-policy.ts";
import { parseTaskContext, type TaskContext } from "../task-context.ts";

const HARNESS = process.env.NEXBOT_HARNESS_URL ?? "http://127.0.0.1:8799";
const BOT_ID = process.env.NEXBOT_BOT_ID ?? "";
const TOKEN = process.env.NEXBOT_COMMS_TOKEN ?? "";
let TASK_CONTEXT: TaskContext | null = parseTaskContext(process.env.NEXBOT_TASK_CONTEXT);

const TOOLS = [
  {
    name: "list_bots",
    description:
      "List the other bots (agents) in this NexBot workspace you can message, with their role, description, built-in skills, model, and whether they're busy. Every bot can coordinate within its active task scope. Call this before ask_bot to discover who's available and match work to the right teammate. There is only one Chief of Staff; never create a second.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ask_bot",
    description:
      "Send a message to another bot in this workspace and BLOCK until it finishes (or times out). The target's reply text is returned as this tool result so you can summarize in the same turn. Every bot can delegate within the current task scope; the harness rejects cycles and enforces a bounded task budget. If the target is still working, you get a still-working note — do not end the turn silently. Never create a second Chief of Staff. Fight X / challenge X means critique X's existing output with a specialist — never ask_bot X to write the critique of itself.",
    inputSchema: {
      type: "object",
      properties: {
        bot_id: { type: "string", description: "The target bot's id (from list_bots)." },
        message: { type: "string", description: "What to say / ask the bot." },
      },
      required: ["bot_id", "message"],
    },
  },
  {
    name: "send_bot",
    description:
      "Send a message to another bot and return immediately. Every bot can delegate within the current task scope. The harness persists the message, queues it if the target is busy, and starts it when the target is free. Use this for delegation, updates, and follow-up work when you do not need to block for a reply.",
    inputSchema: {
      type: "object",
      properties: {
        bot_id: { type: "string", description: "The target bot's id (from list_bots)." },
        message: { type: "string", description: "What to send to the bot." },
      },
      required: ["bot_id", "message"],
    },
  },
  {
    name: "search_history",
    description:
      "Search past messages and transcripts across all bots using SQLite full-text search. Returns matching messages, timestamps, bot IDs, and thread IDs so you can cite exact receipts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms or keywords." },
        limit: { type: "number", description: "Max results to return (default: 10, max: 50)." },
      },
      required: ["query"],
    },
  },
  {
    name: "save_memory",
    description:
      "Save durable facts or dated notes directly to this bot's memory files. Use 'profile' for persistent facts, user preferences, and project constants (profile.md). Use 'log' for append-only dated notes and event summaries in log/YYYY-MM.md.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["profile", "log"],
          description: "Target memory file: 'profile' (durable facts) or 'log' (dated notes).",
        },
        content: {
          type: "string",
          description: "Text content to save or append.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the file or replace its content (default: 'append' for log, 'replace' for profile).",
        },
      },
      required: ["target", "content"],
    },
  },
  {
    name: "get_memory",
    description:
      "Read the current durable profile (profile.md) and current month's dated log (log/YYYY-MM.md) for this bot.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "todo",
    description:
      "Durable checklist for this bot's current job. Call with no items to list. Call with items to replace the list (reuse ids when updating). Statuses: pending, in_progress, completed, cancelled. Keep exactly one item in_progress while you work.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Replace the checklist with these items. Omit to only list.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
            },
            required: ["content", "status"],
          },
        },
      },
    },
  },
];

type Json = Record<string, unknown>;
const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id: unknown, text: string, isError = false) =>
  ok(id, { content: [{ type: "text", text }], isError });

async function api(path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(HARNESS + path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
  return body;
}

async function callTool(name: string, args: Json): Promise<{ text: string; isError?: boolean }> {
  if (name === "list_bots") {
    const r = await api(`/api/internal/agents?self=${encodeURIComponent(BOT_ID)}`);
    const bots = (r.bots as Array<Json>) ?? [];
    const scope = TASK_CONTEXT
      ? `Current task scope: ${TASK_CONTEXT.maxHops - TASK_CONTEXT.hops} hop(s) and ${TASK_CONTEXT.maxMessages - TASK_CONTEXT.messages} message(s) remain. Active path: ${TASK_CONTEXT.path.join(" → ")}.`
      : "This turn has no valid task scope.";
    if (!bots.length) return { text: `${scope}\nNo other bots in this workspace yet.` };
    const lines = bots.map((b) => {
      const role = b.title ? ` — ${b.title}` : "";
      const description = b.description ? `: ${b.description}` : "";
      const skills = Array.isArray(b.enabledSkillSlugs) && b.enabledSkillSlugs.length ? ` [skills: ${b.enabledSkillSlugs.join(", ")}]` : "";
      return `- ${b.name}${role}${description} (id: ${b.id}, model: ${b.model}${b.busy ? ", busy" : ""})${skills}`;
    });
    return { text: `${scope}\nOther bots you can message with ask_bot or send_bot:\n${lines.join("\n")}` };
  }
  if (name === "ask_bot") {
    const toBotId = String(args.bot_id ?? "").trim();
    const message = String(args.message ?? "").trim();
    if (!toBotId || !message) return { text: "ask_bot needs bot_id and message.", isError: true };
    if (!TASK_CONTEXT) return { text: "This task has no valid coordination context.", isError: true };
    let r: Json;
    try {
      r = await api(`/api/internal/ask-bot`, {
        method: "POST",
        body: JSON.stringify({ fromBotId: BOT_ID, toBotId, message, taskContext: TASK_CONTEXT }),
        signal: AbortSignal.timeout(ASK_BOT_HTTP_TIMEOUT_MS),
      });
    } catch (e) {
      const errName = (e as Error).name;
      if (errName === "TimeoutError" || errName === "AbortError") {
        return { text: ASK_BOT_STILL_WORKING };
      }
      throw e;
    }
    const nextContext = parseTaskContext(r.taskContext);
    if (nextContext) TASK_CONTEXT = nextContext;
    if (r.busy) return { text: `That bot is busy right now — try again after it finishes.` };
    if (r.error) return { text: `Couldn't reach that bot: ${r.error}`, isError: true };
    const reply = String(r.text ?? "");
    if (!reply || reply === ASK_BOT_STILL_WORKING) {
      return { text: reply || ASK_BOT_STILL_WORKING };
    }
    return { text: `${r.botName ?? "Bot"} replied:\n${reply}` };
  }
  if (name === "send_bot") {
    const toBotId = String(args.bot_id ?? "").trim();
    const message = String(args.message ?? "").trim();
    if (!toBotId || !message) return { text: "send_bot needs bot_id and message.", isError: true };
    if (!TASK_CONTEXT) return { text: "This task has no valid coordination context.", isError: true };
    const r = await api(`/api/internal/send-bot`, {
      method: "POST",
      body: JSON.stringify({ fromBotId: BOT_ID, toBotId, message, taskContext: TASK_CONTEXT }),
    });
    const nextContext = parseTaskContext(r.taskContext);
    if (nextContext) TASK_CONTEXT = nextContext;
    if (r.error) return { text: `Couldn't queue that message: ${r.error}`, isError: true };
    return {
      text: `Message queued for ${r.botName ?? "the bot"}${r.busy ? " (it will run after the current turn)" : ""}. Queue position: ${r.position ?? 1}.`,
    };
  }
  if (name === "search_history") {
    const query = String(args.query ?? "").trim();
    if (!query) return { text: "search_history needs a query.", isError: true };
    const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 10;
    const r = await api(`/api/internal/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    const results = (r.results as Array<{ messageId: string; threadId: string; botId: string | null; botName?: string; text: string; at: number }>) ?? [];
    if (!results.length) return { text: `No past messages found matching "${query}".` };
    const lines = results.map((hit) => {
      const date = new Date(hit.at).toISOString().replace("T", " ").slice(0, 16);
      return `- [${date}] [receipt: thread=${hit.threadId} msg=${hit.messageId}] ${hit.botName ? `@${hit.botName}` : "user"}: ${hit.text}`;
    });
    return { text: `Found ${results.length} receipt(s) for "${query}":\n${lines.join("\n")}` };
  }
  if (name === "save_memory") {
    const target = String(args.target ?? "log").trim();
    const content = String(args.content ?? "").trim();
    const mode = typeof args.mode === "string" ? args.mode.trim() : undefined;
    if (!content) return { text: "save_memory needs content.", isError: true };
    const r = await api(`/api/internal/memory`, {
      method: "POST",
      body: JSON.stringify({ botId: BOT_ID, target, content, mode }),
    });
    return { text: String(r.text ?? "Memory saved."), isError: Boolean(r.isError) };
  }
  if (name === "get_memory") {
    const r = await api(`/api/internal/memory?botId=${encodeURIComponent(BOT_ID)}`);
    return { text: String(r.text ?? ""), isError: Boolean(r.isError) };
  }
  if (name === "todo") {
    const payload: Record<string, unknown> = { botId: BOT_ID };
    if ("items" in args) payload.items = args.items;
    const r = await api(`/api/internal/todos`, { method: "POST", body: JSON.stringify(payload) });
    return { text: String(r.text ?? ""), isError: Boolean(r.isError) };
  }
  return { text: `Unknown tool: ${name}`, isError: true };
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
        serverInfo: { name: "nexbot-agents", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params.name as string;
      if (!TOOLS.some((t) => t.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
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
