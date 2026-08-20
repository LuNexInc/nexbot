// Per-bot credential vault MCP. Secrets stay encrypted at rest and are never
// returned in a tool result. fill_credential sends a granted value directly
// to the local CUA type-text tool for the field that the user or bot focused.
import { spawn } from "node:child_process";
import readline from "node:readline";

const HARNESS = process.env.NEXBOT_HARNESS_URL ?? "http://127.0.0.1:8799";
const BOT_ID = process.env.NEXBOT_BOT_ID ?? "";
const TOKEN = process.env.NEXBOT_COMMS_TOKEN ?? "";

type Json = Record<string, unknown>;
type CuaSpec = { command: string; args: string[]; env: Record<string, string> };

function cuaSpec(): CuaSpec | null {
  try {
    const raw = JSON.parse(process.env.NEXBOT_CUA_SPEC ?? "null") as Partial<CuaSpec> | null;
    if (!raw?.command) return null;
    return { command: raw.command, args: raw.args ?? [], env: raw.env ?? {} };
  } catch { return null; }
}

async function api(path: string): Promise<Json> {
  const response = await fetch(HARNESS + path, { headers: { authorization: `Bearer ${TOKEN}` } });
  const body = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
  return body;
}

async function typeWithCua(secret: string): Promise<void> {
  const spec = cuaSpec();
  if (!spec) throw new Error("Local computer control is unavailable.");
  const child = spawn(spec.command, spec.args, {
    env: { ...process.env, ...spec.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline = -1;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (typeof message.id === "number" && pending.has(message.id)) {
          const waiter = pending.get(message.id)!;
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(String(message.error.message ?? "CUA request failed")));
          else waiter.resolve(message.result);
        }
      } catch {}
    }
  });
  const request = (id: number, method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timeout = setTimeout(() => {
    for (const waiter of pending.values()) waiter.reject(new Error("CUA credential fill timed out"));
    pending.clear();
    child.kill();
  }, 20_000);
  try {
    await request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nexbot-credentials", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await request(2, "tools/list", {});
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    const typeTool = tools.find((tool: any) => /(?:^|[_-])type(?:_text)?$/i.test(String(tool?.name ?? "")))
      ?? tools.find((tool: any) => /type.*text/i.test(String(tool?.name ?? "")));
    if (!typeTool?.name) throw new Error("Local CUA does not expose a type-text tool.");
    const result = await request(3, "tools/call", { name: typeTool.name, arguments: { text: secret } });
    if (result?.isError) throw new Error("Local CUA rejected the credential fill.");
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}

const TOOLS = [
  {
    name: "list_credentials",
    description: "List credential labels granted to this bot. Secret values are never shown.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fill_credential",
    description: "Type one granted credential into the currently focused field on this PC. The secret is not returned to the model.",
    inputSchema: {
      type: "object",
      properties: { credential_id: { type: "string", description: "Credential id from list_credentials." } },
      required: ["credential_id"],
    },
  },
];

async function callTool(name: string, args: Json): Promise<string> {
  if (name === "list_credentials") {
    const result = await api(`/api/internal/credentials?botId=${encodeURIComponent(BOT_ID)}`);
    const rows = (result.credentials as Array<{ id: string; label: string; envName: string }>) ?? [];
    return rows.length ? rows.map((row) => `- ${row.label} (${row.envName}, id: ${row.id})`).join("\n") : "No credentials are granted to this bot.";
  }
  if (name === "fill_credential") {
    const id = String(args.credential_id ?? "").trim();
    if (!id) throw new Error("credential_id is required");
    const result = await api(`/api/internal/credentials/${encodeURIComponent(id)}/reveal?botId=${encodeURIComponent(BOT_ID)}`);
    const secret = String(result.secret ?? "");
    if (!secret) throw new Error("Credential is unavailable or not granted to this bot.");
    await typeWithCua(secret);
    return `Filled ${String(result.label ?? "credential")} into the focused field.`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

const send = (message: Json) => process.stdout.write(JSON.stringify(message) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  void (async () => {
    let message: Json;
    try { message = JSON.parse(line) as Json; } catch { return; }
    const id = message.id;
    const method = String(message.method ?? "");
    if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "nexbot-credentials", version: "1" } } });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      const params = (message.params ?? {}) as Json;
      try {
        const text = await callTool(String(params.name ?? ""), (params.arguments ?? {}) as Json);
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (error) {
        return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] } });
      }
    }
    if (id !== undefined && !method.startsWith("notifications/")) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  })();
});
