// Contract test for the agent-to-agent comms MCP proxy (agents-proxy.ts):
// spawn it exactly the way a driver's mcpServers entry does (process.execPath
// + entry file + env) against a scripted stub of the harness's /api/internal
// endpoints, and drive the MCP stdio surface end to end. No shebang, no
// shell — plain node child, so this runs on every OS like index.test.ts.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTaskContext } from "../task-context.ts";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "agents-proxy.ts");
const TOKEN = "test-comms-token";
const TASK_CONTEXT = createTaskContext("bot-asker");

// scripted harness stub
let stub: Server;
let stubPort = 0;
let lastAuth: string | undefined;
let lastAskBody: any = null;
let lastSendBody: any = null;
let askResponse: unknown = { botName: "Helper", text: "hi from helper" };
let askDelayMs = 0;

let child: ChildProcess;
const pending = new Map<number, (msg: any) => void>();
let nextId = 100;

function rpc(method: string, params?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 10_000).unref?.();
  });
}
const callTool = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });

beforeAll(async () => {
  stub = createServer((req, res) => {
    lastAuth = req.headers.authorization;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.method === "GET" && req.url?.startsWith("/api/internal/agents")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          bots: [{
            id: "bot-helper",
            name: "Helper",
            title: "Helper role",
            description: "Built-in helper skills",
            enabledSkillSlugs: ["helper-skill"],
            model: "fake-model",
            busy: false,
          }],
        }),
      );
    }
    if (req.method === "POST" && req.url === "/api/internal/ask-bot") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        lastAskBody = JSON.parse(data);
        const body = askResponse;
        const delay = askDelayMs;
        const reply = () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...(body as any), taskContext: TASK_CONTEXT }));
        };
        if (delay > 0) setTimeout(reply, delay);
        else reply();
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/internal/send-bot") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        lastSendBody = JSON.parse(data);
        res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ queued: true, position: 2, botName: "Helper", busy: true, taskContext: TASK_CONTEXT }));
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/internal/todos") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            text: Array.isArray(body.items)
              ? `[>] td-1 ${body.items[0]?.content ?? "item"} (in_progress)`
              : "Checklist is empty.",
            items: body.items ?? [],
          }),
        );
      });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/internal/search")) {
      const u = new URL(req.url, `http://127.0.0.1:${stubPort}`);
      const q = u.searchParams.get("q");
      res.writeHead(200, { "content-type": "application/json" });
      if (q === "deploy") {
        return res.end(
          JSON.stringify({
            results: [
              {
                messageId: "msg-123",
                threadId: "th-456",
                botId: "bot-helper",
                botName: "Helper",
                text: "Deployed v2.4.31 to production",
                at: 1770000000000,
              },
            ],
          }),
        );
      }
      return res.end(JSON.stringify({ results: [] }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown" }));
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = (stub.address() as { port: number }).port;

  child = spawn(process.execPath, [PROXY], {
    env: {
      ...process.env,
      NEXBOT_HARNESS_URL: `http://127.0.0.1:${stubPort}`,
      NEXBOT_BOT_ID: "bot-asker",
      NEXBOT_COMMS_TOKEN: TOKEN,
      NEXBOT_TASK_CONTEXT: JSON.stringify(TASK_CONTEXT),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  child.stdout!.on("data", (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
});

afterAll(async () => {
  child?.kill();
  await new Promise<void>((r) => stub.close(() => r()));
});

describe("agents-proxy MCP surface", () => {
  it("answers the MCP handshake and lists the communication tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05" });
    expect(init.result.serverInfo.name).toContain("agents");
    const list = await rpc("tools/list");
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "list_bots",
      "ask_bot",
      "send_bot",
      "search_history",
      "todo",
    ]);
    const ask = list.result.tools.find((t: { name: string }) => t.name === "ask_bot");
    expect(ask.description).toMatch(/never create a second Chief of Staff/i);
    expect(ask.description).toMatch(/never ask_bot X to write the critique/i);
  });

  it("list_bots renders the roster and authenticates with the shared token", async () => {
    const res = await callTool("list_bots", {});
    const text = res.result.content[0].text;
    expect(text).toContain("Helper");
    expect(text).toContain("bot-helper");
    expect(text).toContain("Helper role");
    expect(text).toContain("Built-in helper skills");
    expect(lastAuth).toBe(`Bearer ${TOKEN}`);
  });

  it("ask_bot forwards sender + task context and returns the reply", async () => {
    askResponse = { botName: "Helper", text: "hi from helper" };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.content[0].text).toContain("Helper replied:");
    expect(res.result.content[0].text).toContain("hi from helper");
    expect(lastAskBody).toMatchObject({ fromBotId: "bot-asker", toBotId: "bot-helper", message: "ping", taskContext: TASK_CONTEXT });
  });

  it("renders a busy peer as a clean answer, not an error", async () => {
    askResponse = { busy: true };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.content[0].text).toContain("busy");
    expect(res.result.isError).toBeFalsy();
  });

  it("send_bot queues a message and returns without waiting", async () => {
    const res = await callTool("send_bot", { bot_id: "bot-helper", message: "please pick this up" });
    expect(res.result.content[0].text).toMatch(/queued/i);
    expect(res.result.content[0].text).toMatch(/after the current turn/i);
    expect(lastSendBody).toMatchObject({ fromBotId: "bot-asker", toBotId: "bot-helper", message: "please pick this up", taskContext: TASK_CONTEXT });
  });

  it("surfaces the harness's task-scope refusal as a tool error", async () => {
    askResponse = { error: "task delegation would create a cycle" };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("cycle");
  });

  it("rejects unknown tools with -32602", async () => {
    const res = await rpc("tools/call", { name: "made_up", arguments: {} });
    expect(res.error.code).toBe(-32602);
  });

  it("requires bot_id and message", async () => {
    const res = await callTool("ask_bot", { bot_id: "", message: "" });
    expect(res.result.isError).toBe(true);
  });

  it("ask_bot waits for a slow peer and returns the reply in the same call", async () => {
    askDelayMs = 250;
    askResponse = { botName: "Helper", text: "slow hello" };
    const started = Date.now();
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(res.result.content[0].text).toContain("slow hello");
    askDelayMs = 0;
  });

  it("surfaces a still-working timeout note as a normal tool result", async () => {
    askResponse = { botName: "Helper", text: "That bot is still working — try again after it finishes." };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.isError).toBeFalsy();
    expect(res.result.content[0].text).toMatch(/still working/i);
  });
  it("todo lists and replaces the checklist via the harness", async () => {
    const listed = await callTool("todo", {});
    expect(listed.result.content[0].text).toMatch(/empty/i);
    const wrote = await callTool("todo", { items: [{ content: "Draft brief", status: "in_progress" }] });
    expect(wrote.result.content[0].text).toContain("Draft brief");
  });

  it("search_history returns receipts with message and thread IDs", async () => {
    const res = await callTool("search_history", { query: "deploy" });
    expect(res.result.isError).toBeFalsy();
    const text = res.result.content[0].text;
    expect(text).toContain("Found 1 receipt(s)");
    expect(text).toContain("[receipt: thread=th-456 msg=msg-123]");
    expect(text).toContain("@Helper: Deployed v2.4.31 to production");
  });

  it("search_history handles empty search results cleanly", async () => {
    const res = await callTool("search_history", { query: "nonexistent" });
    expect(res.result.isError).toBeFalsy();
    expect(res.result.content[0].text).toMatch(/No past messages found/i);
  });

  it("search_history validates missing query parameter", async () => {
    const res = await callTool("search_history", { query: "" });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("needs a query");
  });
});
