// Transparent MCP gate in front of the local CUA driver. Operator takeover
// blocks new computer actions before they reach the native driver.
import { spawn } from "node:child_process";
import readline from "node:readline";

const HARNESS = process.env.NEXBOT_HARNESS_URL ?? "http://127.0.0.1:8799";
const BOT_ID = process.env.NEXBOT_BOT_ID ?? "";
const TOKEN = process.env.NEXBOT_COMMS_TOKEN ?? "";

type Spec = { command: string; args: string[]; env: Record<string, string> };
let spec: Spec | null = null;
try {
  const parsed = JSON.parse(process.env.NEXBOT_CUA_SPEC ?? "null") as Partial<Spec> | null;
  if (parsed?.command) spec = { command: parsed.command, args: parsed.args ?? [], env: parsed.env ?? {} };
} catch {}

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");

if (!spec) {
  process.stdin.resume();
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Local CUA is unavailable" } });
    } catch {}
  });
} else {
  const child = spawn(spec.command, spec.args, {
    env: { ...process.env, ...spec.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(process.stdout);
  child.on("close", () => process.exit(0));
  child.on("error", (error) => send({ jsonrpc: "2.0", error: { code: -32000, message: error.message } }));

  const input = readline.createInterface({ input: process.stdin });
  input.on("line", (line) => {
    void (async () => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; } catch { return; }
      if (message.method === "tools/call") {
        try {
          const response = await fetch(`${HARNESS}/api/internal/operator?botId=${encodeURIComponent(BOT_ID)}`, {
            headers: { authorization: `Bearer ${TOKEN}` },
            signal: AbortSignal.timeout(2_000),
          });
          const state = await response.json().catch(() => ({})) as { active?: boolean };
          if (!response.ok || state.active) {
            return send({
              jsonrpc: "2.0",
              id: message.id,
              result: { isError: true, content: [{ type: "text", text: "Operator takeover is active. Wait until the user gives control back." }] },
            });
          }
        } catch {
          return send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "NexBot could not verify computer-control ownership." }] } });
        }
      }
      child.stdin.write(line + "\n");
    })();
  });
  process.stdin.on("end", () => child.stdin.end());
}
