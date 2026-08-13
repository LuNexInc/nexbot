// NexBot server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { configStatus } from "./app-meta.ts";
import * as box from "./box.ts";
import * as composio from "./composio.ts";
import { ensureDirs, instanceConfigs, loadConfig, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { readCuaConnection } from "./cua-connection.ts";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { EventBus } from "./harness/bus.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { buildPersona, deskPath, deskPrompt, ensureDesk, ensureMemory, inboxPath, MEMORY_FILE_MAX, memoryDir, memoryPrompt, readLog, readProfile, writeInboxFile, writeLog, writeProfile } from "./desk.ts";
import { isForbiddenSecretAccess } from "./environ-guard.ts";
import { json, readBody, serveStatic, portBusyHint } from "./http-util.ts";
import { forgetTurn, listPending, rememberTurn } from "./pending.ts";
import {
  createRoutine,
  deleteRoutine,
  deleteRoutinesForBot,
  dueRoutines,
  listRoutines,
  markRan,
  normalizeRoutineKind,
  patchRoutine,
  routineCreateError,
  routineHookPath,
} from "./routines.ts";
import { ASK_BOT_STILL_WORKING, ASK_BOT_WAIT_MS } from "./comms-policy.ts";
import { createScreenPoller } from "./screen-poller.ts";
import { detectCapabilities } from "./capabilities.ts";
import { clipForTurn, handoffThreadIds, mentionedBots, Store, type Message } from "./store.ts";
import { roleByTitle, SLEEP_WARNING, COS_PROMPT, isChiefOfStaffRole, isForbiddenFightAsk } from "./roles.ts";
import { deleteSkill, listSkills, saveSkill, skillFromTurn, skillsPrompt } from "./skills.ts";
import { checkSteerToken, loadSteerToken, rotateSteerToken, tokenFromRequest } from "./steer.ts";
import { createWatchdog, isComputerToolName } from "./watchdog.ts";
import { pickDefaultSelection } from "./selection.ts";

const PORT = Number(process.env.NEXBOT_PORT || 8799);
const STATIC_DIR = process.env.NEXBOT_STATIC_DIR || null;

ensureDirs();
const cfg = loadConfig();
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));

const bus = new EventBus();
bus.attach(registry.instances());

// ── peer-agent comms wiring ────────────────────────────────────────────
// A shared secret guards the localhost-only /api/internal endpoints the
// agents-proxy calls; regenerated each boot (the proxy gets it via env).
const COMMS_TOKEN = randomBytes(24).toString("hex");
// Cap message chains: depth 0 = a user-initiated turn (may ask a peer);
// a peer invoked via ask_bot runs at depth 1 and gets NO agents tool, so
// A→B is allowed but B→C (and A→B→A loops) never start.
const MAX_COMMS_DEPTH = 1;
// proxy entry: .ts in dev (node type-strips), .js in the packaged dist-server
const agentsProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
// in the packaged app process.execPath is Electron — run the proxy as node
const AGENTS_NODE_FLAG = { ELECTRON_RUN_AS_NODE: "1" };

function agentsIntegration(botId: string, depth: number) {
  return {
    command: process.execPath,
    args: [agentsProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      NEXBOT_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      NEXBOT_BOT_ID: botId,
      NEXBOT_COMMS_TOKEN: COMMS_TOKEN,
      NEXBOT_TURN_DEPTH: String(depth),
    },
  };
}

/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
type StartTurnOpts = {
  commsDepth?: number;
  replay?: boolean;
  groupId?: string;
  fromBot?: { id: string; name: string; color?: string };
  chatText?: string;
};

function askBotAndWait(targetBotId: string, message: string, depth: number, extra?: Pick<StartTurnOpts, "fromBot" | "chatText">): Promise<string> {
  const target = store.bot(targetBotId);
  if (!target) return Promise.resolve("(no such bot)");
  const threadId = target.threadId;
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    const finish = (out: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(out);
    };
    const unsub = bus.subscribe((e: RuntimeEvent) => {
      if (e.threadId !== threadId) return;
      if (e.type === "item.completed" && e.itemType === "assistant_text") {
        text += (text ? "\n" : "") + e.text;
      } else if (e.type === "turn.completed") {
        finish(text || "(the bot finished without a text reply)");
      }
    });
    const timer = setTimeout(() => finish(text || ASK_BOT_STILL_WORKING), ASK_BOT_WAIT_MS);
    startTurn(targetBotId, message, { commsDepth: depth + 1, ...extra }).catch((err) =>
      finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`),
    );
  });
}

// default selection: first available authenticated instance. Prefer grok, then
// codex. Never pick Claude unless it is the only available driver (no Claude auth).
async function defaultSelection() {
  return pickDefaultSelection(await registry.describe());
}
let bootSelection = { instanceId: "grok", model: "grok-4.5" };
const store = new Store(() => bootSelection);
bootSelection = await defaultSelection();
store.seedIfEmpty();
store.ensureTeamSeeds();
const watchdog = createWatchdog({ stuckMs: 90_000 });
let steerToken = loadSteerToken();
/** botId → group thread that started this turn (shared transcript). */
const turnGroup = new Map<string, string>();

// ── SSE fan-out to clients ─────────────────────────────────────────────
const sseClients = new Set<ServerResponse>();
function broadcast(payload: unknown) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── live screen poller ─────────────────────────────────────────────────
const screens = createScreenPoller({
  isConfigured: () => box.boxConfigured(cfg),
  screenshot: (botId) => box.screenshotBox(cfg, botId),
  onFrame: (botId, frame) => broadcast({ kind: "screen", botId, ...frame }),
});

// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map<string, string>(); // itemId -> messageId
const askMessageByRequest = new Map<string, string>(); // requestId -> messageId

bus.subscribe((event: RuntimeEvent) => {
  broadcast({ kind: "runtime", event });
  const bot = store.botByThread(event.threadId);
  if (!bot) return;
  const extra: { tokens?: { input: number; output: number }; computerTool?: boolean } = {};
  if (event.type === "thread.token-usage.updated") {
    extra.tokens = { input: event.input ?? 0, output: event.output ?? 0 };
    store.patchBot(bot.id, { usage: extra.tokens });
    broadcast({ kind: "usage", botId: bot.id, usage: extra.tokens });
  }
  if (event.type === "item.started" && event.itemType === "tool") {
    extra.computerTool = isComputerToolName(event.title);
  }
  watchdog.poke(bot.id, event.type, extra);

  const pushMessage = (m: Omit<Message, "id" | "at">) => {
    const message = store.appendMessage(event.threadId, m);
    broadcast({ kind: "message", threadId: event.threadId, message });
    return message;
  };

  switch (event.type) {
    case "session.started":
      if (event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
      }
      break;
    case "item.completed":
      if (event.itemType === "assistant_text") {
        pushMessage({ role: "bot", kind: "text", text: event.text });
        const gid = turnGroup.get(bot.id);
        if (gid) {
          const group = store.bot(gid);
          if (group) {
            const copied = store.appendMessage(group.threadId, {
              role: "bot",
              kind: "text",
              text: `@${bot.name}: ${event.text}`,
            });
            broadcast({ kind: "message", threadId: group.threadId, message: copied });
          }
        }
      } else if (event.itemType === "tool" && event.itemId) {
        const messageId = toolMessageByItem.get(event.itemId);
        if (messageId) {
          const patched = store.patchMessage(event.threadId, messageId, {
            tool: { name: store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool", ok: event.ok },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
          toolMessageByItem.delete(event.itemId);
        }
        // the bot just finished acting — refresh its screen preview now
        screens.poke(bot.id);
      }
      break;
    case "item.started":
      if (event.itemType === "tool") {
        const message = pushMessage({ role: "bot", kind: "activity", tool: { name: event.title ?? "tool" } });
        if (event.itemId) toolMessageByItem.set(event.itemId, message.id);
      }
      break;
    case "request.opened": {
      if (event.requestType === "permission" && event.requestId) {
        const instance = registry.get(bot.modelSelection.instanceId);
        void instance?.adapter
          .respondToRequest(bot.threadId, event.requestId, { behavior: "allow" })
          .catch(() => {});
        break;
      }
      const message = pushMessage({
        role: "bot",
        kind: "options",
        card: {
          title: "Your bot has a question",
          subtitle: event.summary,
          options: event.choices?.length ? event.choices : [],
          requestId: event.requestId,
        },
      });
      if (event.requestId) askMessageByRequest.set(event.requestId, message.id);
      break;
    }
    case "request.resolved": {
      const messageId = event.requestId ? askMessageByRequest.get(event.requestId) : null;
      if (messageId) {
        const existing = store.messagesFor(event.threadId).find((m) => m.id === messageId);
        if (existing?.card && !existing.card.answered) {
          const patched = store.patchMessage(event.threadId, messageId, {
            card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
        }
        if (event.requestId) askMessageByRequest.delete(event.requestId);
      }
      break;
    }
    case "runtime.error":
      pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
      break;
    case "turn.completed": {
      // only fold a screen frame when this turn used computer tools
      const meta = watchdog.end(bot.id);
      const frame = screens.stop(bot.id);
      if (frame && meta?.computerTools) {
        pushMessage({ role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
      }
      store.patchBot(bot.id, { busy: false, unread: true });
      turnGroup.delete(bot.id);
      forgetTurn(bot.id);
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      if (bot.notifications !== false) {
        broadcast({ kind: "notify", botId: bot.id, title: bot.name, body: `${bot.name} finished.` });
      }
      break;
    }
  }
});

function appendHandoff(opts: {
  from?: { id: string; name: string; color?: string } | null;
  to: { id: string; name: string; color?: string };
  text: string;
}) {
  const fromLabel = opts.from?.name ?? "you";
  const text = `Handoff from @${fromLabel} → @${opts.to.name}:\n\n${opts.text}`;
  const payload: Omit<Message, "id" | "at"> = { role: "bot", kind: "text", text };
  for (const threadId of handoffThreadIds({ from: opts.from, to: opts.to, bots: store.bots })) {
    const message = store.appendMessage(threadId, payload);
    broadcast({ kind: "message", threadId, message });
  }
}

// ── turn dispatch (upstream ProviderCommandReactor, miniature) ──────────
async function startTurn(botId: string, text: string, opts?: StartTurnOpts) {
  const bot = store.bot(botId);
  if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (bot.busy) throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
  const commsDepth = opts?.commsDepth ?? 0;

  if (bot.kind === "group") {
    const members = (bot.memberIds ?? []).map((id) => store.bot(id)).filter(Boolean);
    if (members.length < 2) throw Object.assign(new Error("a group needs 2 to 6 teammates"), { status: 400 });
    const userMessage = store.appendMessage(bot.threadId, { role: "user", kind: "text", text });
    broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });
    for (const member of members) {
      if (!member || member.busy) continue;
      void startTurn(member.id, `[Group @${bot.name}]\n\n${text}`, { commsDepth: 1, groupId: bot.id }).catch(() => {});
    }
    return;
  }

  const instance = registry.get(bot.modelSelection.instanceId);
  if (!instance) {
    throw Object.assign(
      new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }

  const incoming = opts?.fromBot
    ? store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "text",
        text: opts.chatText ?? text,
        fromBot: opts.fromBot,
      })
    : store.appendMessage(bot.threadId, { role: "user", kind: "text", text });
  broadcast({ kind: "message", threadId: bot.threadId, message: incoming });

  // Last-30 text messages, each capped so huge strings cannot blow context.

  ensureDesk(bot.id);
  ensureMemory(bot.id);
  const builtPersona = buildPersona(bot, {
    desk: deskPrompt(bot.id),
    memory: bot.memoryEnabled ? memoryPrompt(bot.id) : "",
    skills: skillsPrompt(bot.enabledSkillSlugs),
  });
  const persona = isChiefOfStaffRole(bot.name, bot.title)
    ? `${builtPersona}\n\n${COS_PROMPT}`
    : builtPersona;

  // busy flips immediately so the composer locks; the dispatch itself runs
  // in the background — box provisioning can take ~90s and must never
  // hang the HTTP request
  store.patchBot(bot.id, { busy: true, unread: false });
  watchdog.start(bot.id);
  if (opts?.groupId) turnGroup.set(bot.id, opts.groupId);
  if (!opts?.commsDepth) rememberTurn(bot.id, text, "user");
  broadcast({ kind: "bot", bot: store.bot(bot.id) });

  if (!opts?.commsDepth && !opts?.replay) {
    for (const peer of mentionedBots(
      text,
      store.bots.filter((b) => b.id !== bot.id && !b.hidden),
    )) {
      if (isForbiddenFightAsk(bot, peer, text)) continue;
      appendHandoff({
        from: { id: bot.id, name: bot.name, color: bot.color },
        to: { id: peer.id, name: peer.name, color: peer.color },
        text,
      });
      if (!peer.busy) {
        void startTurn(peer.id, `[Team job from the user, also sent to @${bot.name}]\n\n${text}`, {
          commsDepth: 1,
        }).catch(() => {});
      }
    }
  }

  void (async () => {
    try {
      const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};
      if (cfg.composio?.key) integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
      // NexBot has no cloud computer. Local CUA only, unless the bot is Off.
      const wants = bot.computer;
      if (wants !== "off") {
        const cua = readCuaConnection();
        if (cua) integrations.localComputer = cua;
      }
      // peer-agent comms: give a user-initiated turn the list_bots/ask_bot
      // tools. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
      // stop, so the user's tokens can't be burned by a bot-to-bot loop.
      // Only drivers that mount the tools get the integration (and, via the
      // integrations.agents gate below, the prompt hint) — a bot on a driver
      // without it must not be told about tools it cannot call. Any bot can
      // still be the TARGET of ask_bot regardless of its driver.
      if (
        commsDepth < MAX_COMMS_DEPTH &&
        instance.adapter.capabilities.agentsMcp === true &&
        store.bots.filter((b) => b.id !== bot.id && !b.hidden).length > 0
      ) {
        integrations.agents = agentsIntegration(bot.id, commsDepth);
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit delegation nudge — the agent still does the ask_bot call
      // itself, so the harness stays the single owner of turns/permissions
      const tagged = mentionedBots(
        text,
        store.bots.filter((b) => b.id !== bot.id),
      );

      await instance.adapter.sendTurn({
        threadId: bot.threadId,
        text,
        model: bot.modelSelection.model,
        resumeCursor: undefined,
        transcript: clipForTurn(store.messagesFor(bot.threadId)),
        system:
          persona +
          (integrations.localComputer
            ? " You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
            : "") +
          (integrations.agents
            ? " You can work with the user's other bots through the agents tools — list_bots shows who's available, ask_bot sends one of them a message and returns their reply. There is only one Chief of Staff — never create a second. Fight X / challenge X means use or spawn a specialist that critiques X's existing output; never ask_bot X to write the critique of itself."
            : "") +
          (integrations.composio
            ? " Connected apps via Composio are available as tools. Use them when they fit."
            : "") +
          ` ${SLEEP_WARNING}` +
          (tagged.length
            ? ` The user also sent this job in parallel to ${tagged
                .map((t) => `@${t.name}`)
                .join(" and ")}. Coordinate if needed; do not wait for them unless you must.`
            : ""),
        integrations,
      });
      /* no cloud-box screen poller — local frames come from Electron */
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failure = store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
      });
      broadcast({ kind: "message", threadId: bot.threadId, message: failure });
      store.patchBot(bot.id, { busy: false });
      watchdog.end(bot.id);
      turnGroup.delete(bot.id);
      forgetTurn(bot.id);
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
    }
  })();
}

/** Rebuild the provider fleet after a config change so new keys take
 * effect without a server restart (kills any in-flight turns). */
async function reloadProviders() {
  bus.detachAll();
  await registry.disposeAll();
  await registry.load(instanceConfigs(cfg));
  bus.attach(registry.instances());
}

// ── HTTP surface ───────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  try {
    // ── internal peer-agent comms (localhost + shared token only) ──────
    // The agents-proxy (spawned inside a bot's agent process) calls these to
    // discover peers and hand a message to one. Not part of the public API.
    if (path.startsWith("/api/internal/")) {
      if (req.headers.authorization !== `Bearer ${COMMS_TOKEN}`) {
        return json(res, 401, { error: "unauthorized" });
      }
      if (method === "GET" && path === "/api/internal/agents") {
        const self = url.searchParams.get("self");
        const bots = store.bots
          .filter((b) => b.id !== self && !b.hidden)
          .map((b) => ({ id: b.id, name: b.name, model: b.modelSelection.model, busy: !!b.busy }));
        return json(res, 200, { bots });
      }
      if (method === "POST" && path === "/api/internal/ask-bot") {
        const body = await readBody(req);
        const fromBotId = String(body.fromBotId ?? "");
        const toBotId = String(body.toBotId ?? "");
        const message = String(body.message ?? "").trim();
        const depth = Number(body.depth ?? 0) || 0;
        if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
        if (toBotId === fromBotId) return json(res, 400, { error: "a bot cannot message itself" });
        if (depth >= MAX_COMMS_DEPTH) return json(res, 200, { error: "message chains are limited to one hop" });
        const target = store.bot(toBotId);
        if (!target || target.hidden) return json(res, 404, { error: "no such bot" });
        if (target.busy) return json(res, 200, { busy: true });
        const from = store.bot(fromBotId);
        if (isForbiddenFightAsk(from, target, message)) {
          return json(res, 200, {
            error: "Fight/challenge X cannot ask_bot X. Critique their existing output, or spawn a specialist.",
          });
        }
        const fromName = from?.name ?? "another bot";
        appendHandoff({
          from: from ? { id: from.id, name: from.name, color: from.color } : null,
          to: { id: target.id, name: target.name, color: target.color },
          text: message,
        });
        if (from) {
          const note = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: `asked @${target.name}: ${message.slice(0, 80)}` },
          });
          broadcast({ kind: "message", threadId: from.threadId, message: note });
          for (const g of store.bots.filter(
            (b) => b.kind === "group" && b.memberIds?.includes(from.id) && b.memberIds.includes(target.id),
          )) {
            const shared = store.appendMessage(g.threadId, {
              role: "bot",
              kind: "activity",
              tool: { name: `@${fromName} → @${target.name}` },
            });
            broadcast({ kind: "message", threadId: g.threadId, message: shared });
          }
        }
        const prefixed = `[Message from @${fromName}, another bot in this NexBot workspace. Reply to them.]\n\n${message}`;
        const reply = await askBotAndWait(toBotId, prefixed, depth, {
          fromBot: from ? { id: from.id, name: from.name, color: from.color } : undefined,
          chatText: message,
        });
        const noTurn =
          reply === "(no such bot)" ||
          reply.startsWith("(couldn't start that bot:") ||
          reply === ASK_BOT_STILL_WORKING;
        if (from && reply && !noTurn) {
          const bubble = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "text",
            text: reply,
            fromBot: { id: target.id, name: target.name, color: target.color },
          });
          broadcast({ kind: "message", threadId: from.threadId, message: bubble });
        }
        return json(res, 200, { botName: target.name, text: reply });
      }
      return json(res, 404, { error: "unknown internal endpoint" });
    }

    // ── events stream ──
    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
      sseClients.add(res);
      const keepalive = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {}
      }, 25_000);
      req.on("close", () => {
        clearInterval(keepalive);
        sseClients.delete(res);
      });
      return;
    }

    // ── bots ──
    if (method === "GET" && path === "/api/bots") {
      return json(res, 200, {
        bots: store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId) })),
      });
    }
    if (method === "POST" && path === "/api/bots") {
      const body = await readBody(req).catch(() => ({}));
      const kind = body.kind === "group" ? "group" : "bot";
      const memberIds = Array.isArray(body.memberIds) ? [...new Set(body.memberIds.map(String))] : [];
      if (kind === "group") {
        const invalid = groupMemberError(memberIds);
        if (invalid) return json(res, 400, { error: invalid });
      }
      const bot = store.createBot({
        kind,
        name: typeof body.name === "string" ? body.name : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        memberIds,
      });
      store.patchBot(bot.id, { modelSelection: await defaultSelection() });
      const created = store.bot(bot.id)!;
      broadcast({ kind: "bot", bot: created });
      return json(res, 201, { bot: { ...created, messages: store.messagesFor(bot.threadId) } });
    }
    let m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const existing = store.bot(m[1]);
      if (!existing) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      if (body.kind !== undefined && body.kind !== existing.kind) {
        return json(res, 400, { error: "kind cannot be changed" });
      }
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "title", "description", "notifications", "modelSelection", "unread", "computer", "color", "mascotExpression", "pinned", "hidden", "memoryEnabled", "enabledSkillSlugs", "memberIds"] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (patch.memberIds !== undefined) {
        if (existing.kind !== "group") {
          return json(res, 400, { error: "memberIds is only for groups" });
        }
        if (!Array.isArray(patch.memberIds)) {
          return json(res, 400, { error: "memberIds must be an array" });
        }
        const ids = [...new Set(patch.memberIds.map(String))];
        const invalid = groupMemberError(ids);
        if (invalid) return json(res, 400, { error: invalid });
        patch.memberIds = ids;
      }
      // Hidden bots drop off jobs/ask_bot. CoS must stay reachable — same
      // seat as last-CoS DELETE 409. Specialists can hide; user chat still works.
      if (patch.hidden && store.isLastChiefOfStaff(existing.id)) {
        return json(res, 400, { error: "cannot hide the Chief of Staff" });
      }
      const bot = store.patchBot(m[1], patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      broadcast({ kind: "bot", bot });
      return json(res, 200, { bot });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (store.isLastChiefOfStaff(bot.id)) {
        return json(res, 409, { error: "cannot delete the last Chief of Staff" });
      }
      // a running turn dies with its bot
      await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
      screens.stop(bot.id);
      store.deleteBot(bot.id);
      deleteRoutinesForBot(bot.id);
      syncFileWatches();
      for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
        try {
          unlinkSync(join(dir, `${bot.threadId}.ndjson`));
        } catch {}
      }
      broadcast({ kind: "bot.deleted", botId: bot.id });
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 200, { ok: true });
    }

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
      const body = await readBody(req);
      const patched = store.patchMessage(bot.threadId, m[2], {
        card: {
          ...existing.card,
          ...(body.answered !== undefined ? { answered: body.answered } : {}),
          ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
        },
      });
      if (typeof body.answered === "string") {
        const role = roleByTitle(body.answered);
        if (role) {
          store.patchBot(bot.id, { title: role.title, description: role.description, name: bot.name === "New Bot" ? role.name : bot.name });
          broadcast({ kind: "bot", bot: store.bot(bot.id) });
        }
      }
      broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
      return json(res, 200, { message: patched });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      let text = String(body.text ?? "").trim();
      const files = Array.isArray(body.files) ? body.files : [];
      if (files.length) {
        ensureDesk(m[1]);
        for (const f of files) {
          try {
            // Composer sends base64 `data` only. A raw `path` would copy any
            // file the harness can read (config, environ) into the bot inbox.
            if (typeof f?.data === "string" && f.data) {
              writeInboxFile(m[1], String(f.name ?? "file"), Buffer.from(f.data, "base64"));
            }
          } catch {}
        }
        text = `${text}\n\nAttached files are in ${inboxPath(m[1])}.`.trim();
      }
      if (!text) return json(res, 400, { error: "text required" });
      await startTurn(m[1], text);
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const instance = registry.get(bot.modelSelection.instanceId);
      if (!instance) return json(res, 409, { error: "provider unavailable" });
      await instance.adapter.respondToRequest(bot.threadId, String(body.requestId), {
        behavior: body.behavior,
        message: body.message,
      });
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const instance = registry.get(bot.modelSelection.instanceId);
      // Provider interrupt is best-effort. A throw must never leave busy stuck
      // or the Stop button looks dead — always clear local turn state.
      try {
        await instance?.adapter.interruptTurn(bot.threadId);
      } catch {
        /* provider failed; local busy still clears below */
      }
      watchdog.end(bot.id);
      turnGroup.delete(bot.id);
      store.patchBot(bot.id, { busy: false });
      forgetTurn(bot.id);
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/preview$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const png = String(body.png ?? "");
      if (!png) return json(res, 400, { error: "png required" });
      broadcast({ kind: "screen", botId: bot.id, png, mime: String(body.mime ?? "image/png") });
      return json(res, 200, { ok: true });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/memory$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      ensureMemory(bot.id);
      const profile = readProfile(bot.id);
      const log = readLog(bot.id);
      return json(res, 200, {
        enabled: Boolean(bot.memoryEnabled),
        profile,
        log,
        text: profile,
        dir: memoryDir(bot.id),
        desk: deskPath(bot.id),
      });
    }
    if (m && method === "PUT") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const profileText = typeof body.profile === "string" ? body.profile : typeof body.text === "string" ? body.text : undefined;
      const logText = typeof body.log === "string" ? body.log : undefined;
      if ((profileText && profileText.length > MEMORY_FILE_MAX) || (logText && logText.length > MEMORY_FILE_MAX)) {
        return json(res, 400, { error: "memory text too large" });
      }
      if (profileText !== undefined) writeProfile(bot.id, profileText);
      if (logText !== undefined) writeLog(bot.id, logText);
      if (body.enabled !== undefined) store.patchBot(bot.id, { memoryEnabled: Boolean(body.enabled) });
      const next = store.bot(bot.id)!;
      broadcast({ kind: "bot", bot: next });
      const profile = readProfile(bot.id);
      const log = readLog(bot.id);
      return json(res, 200, {
        enabled: Boolean(next.memoryEnabled),
        profile,
        log,
        text: profile,
        dir: memoryDir(bot.id),
        desk: deskPath(bot.id),
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/desk$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { path: ensureDesk(bot.id) });
    }

    if (method === "GET" && path === "/api/routines") {
      const botId = url.searchParams.get("botId") ?? undefined;
      return json(res, 200, { routines: listRoutines(botId || undefined) });
    }
    if (method === "POST" && path === "/api/routines") {
      const body = await readBody(req);
      const botId = String(body.botId ?? "");
      const prompt = String(body.prompt ?? "").trim();
      if (!store.bot(botId) || !prompt) return json(res, 400, { error: "botId and prompt required" });
      const kind = normalizeRoutineKind(body.kind);
      const watchPath = typeof body.watchPath === "string" ? body.watchPath : undefined;
      const dailyAt = typeof body.dailyAt === "string" ? body.dailyAt : undefined;
      const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret : undefined;
      const invalid = routineCreateError({ kind, watchPath, dailyAt, webhookSecret });
      if (invalid) return json(res, 400, { error: invalid });
      const routine = createRoutine({
        botId,
        name: String(body.name ?? prompt).slice(0, 80),
        prompt,
        kind,
        webhookSecret,
        githubRepo: typeof body.githubRepo === "string" ? body.githubRepo : undefined,
        watchPath,
        everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : undefined,
        dailyAt,
        weekdaysOnly: Boolean(body.weekdaysOnly),
        enabled: body.enabled !== false,
      });
      syncFileWatches();
      broadcast({ kind: "routines", routines: listRoutines() });
      const hookUrl = kind === "webhook" ? `http://127.0.0.1:${PORT}${routineHookPath(routine.id)}` : undefined;
      return json(res, 201, { routine, hookUrl });
    }
    if (method === "POST" && path === "/api/webhooks/github") {
      const body = await readBody(req);
      const provided = headerSecret(req);
      for (const r of listRoutines().filter((row) => row.enabled && row.kind === "webhook")) {
        if (!r.webhookSecret || !secretsMatch(r.webhookSecret, provided)) continue;
        if (r.githubRepo && !repoMatches(r.githubRepo, body)) continue;
        fireRoutineEvent(r, `Webhook event:\n${JSON.stringify(body, null, 2)}`);
      }
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/routines\/hooks\/([\w-]+)$/);
    if (m && method === "POST") {
      const routine = listRoutines().find((row) => row.id === m![1]);
      if (!routine) return json(res, 404, { error: "no such routine" });
      const body = await readBody(req);
      const provided = headerSecret(req);
      if (!routine.webhookSecret || !secretsMatch(routine.webhookSecret, provided)) {
        return json(res, 401, { error: "bad secret" });
      }
      if (routine.githubRepo && !repoMatches(routine.githubRepo, body)) {
        return json(res, 200, { skipped: "repo" });
      }
      fireRoutineEvent(routine, `Webhook event:\n${JSON.stringify(body, null, 2)}`);
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/routines\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const existing = listRoutines().find((row) => row.id === m[1]);
      if (!existing) return json(res, 404, { error: "no such routine" });
      const merged = { ...existing, ...body };
      const invalid = routineCreateError({
        kind: merged.kind,
        watchPath: merged.watchPath,
        dailyAt: merged.dailyAt,
        webhookSecret: merged.webhookSecret,
      });
      if (invalid) return json(res, 400, { error: invalid });
      const routine = patchRoutine(m[1], body);
      if (!routine) return json(res, 404, { error: "no such routine" });
      syncFileWatches();
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 200, { routine });
    }
    if (m && method === "DELETE") {
      if (!deleteRoutine(m[1])) return json(res, 404, { error: "no such routine" });
      syncFileWatches();
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/skills") {
      return json(res, 200, { skills: listSkills() });
    }
    if (method === "POST" && path === "/api/skills") {
      const body = await readBody(req);
      try {
        const skill = saveSkill({
          name: String(body.name ?? ""),
          description: String(body.description ?? ""),
          fields: body.fields && typeof body.fields === "object" ? body.fields : undefined,
          slug: typeof body.slug === "string" ? body.slug : undefined,
        });
        if (body.routine && body.botId && store.bot(String(body.botId))) {
          createRoutine({
            botId: String(body.botId),
            name: skill.name,
            prompt: `Follow the skill "${skill.name}" at ${skill.path}.`,
            everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : 60,
            enabled: true,
          });
          broadcast({ kind: "routines", routines: listRoutines() });
        }
        return json(res, 201, { skill });
      } catch (e) {
        const status = (e as { status?: number }).status ?? 400;
        return json(res, status, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (method === "POST" && path === "/api/skills/from-turn") {
      const body = await readBody(req);
      const bot = store.bot(String(body.botId ?? ""));
      if (!bot) return json(res, 404, { error: "no such bot" });
      const msgs = store.messagesFor(bot.threadId);
      const userText = [...msgs].reverse().find((m) => m.role === "user" && m.kind === "text")?.text ?? "";
      const assistantText = [...msgs].reverse().find((m) => m.role === "bot" && m.kind === "text")?.text ?? "";
      const toolNames = msgs.filter((m) => m.kind === "activity" && m.tool?.name).map((m) => m.tool!.name);
      const draft = skillFromTurn({ name: typeof body.name === "string" ? body.name : undefined, userText, assistantText, toolNames });
      const skill = saveSkill(draft);
      if (body.routine) {
        createRoutine({
          botId: bot.id,
          name: skill.name,
          prompt: `Follow the skill "${skill.name}" at ${skill.path}.`,
          everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : 60,
          enabled: true,
        });
        broadcast({ kind: "routines", routines: listRoutines() });
      }
      return json(res, 201, { skill });
    }
    m = path.match(/^\/api\/skills\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (!deleteSkill(m[1])) return json(res, 404, { error: "no such skill" });
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/steer") {
      return json(res, 200, {
        token: steerToken,
        path: `/m.html?token=${steerToken}`,
        bind: process.env.NEXBOT_BIND || "127.0.0.1",
        port: PORT,
      });
    }
    if (method === "POST" && path === "/api/steer/rotate") {
      steerToken = rotateSteerToken();
      return json(res, 200, { token: steerToken, path: `/m.html?token=${steerToken}` });
    }
    if (method === "POST" && path === "/api/steer/jobs") {
      const provided = tokenFromRequest(req.headers.authorization, url.searchParams.get("token"));
      if (!checkSteerToken(provided)) return json(res, 401, { error: "bad steer token" });
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      const botIds = Array.isArray(body.botIds) ? body.botIds.map(String) : [];
      if (!text || !botIds.length) return json(res, 400, { error: "text and botIds required" });
      const started: string[] = [];
      for (const id of botIds) {
        const b = store.bot(id);
        if (!b || b.busy || b.hidden || b.kind === "group") continue;
        await startTurn(id, `[Steer]\n\n${text}`, { commsDepth: 1 }).catch(() => {});
        started.push(id);
      }
      return json(res, 202, { started });
    }

    if (method === "GET" && path === "/api/capabilities") {
      return json(
        res,
        200,
        detectCapabilities({
          cuaReady: Boolean(readCuaConnection()),
          electron: Boolean(process.env.NEXBOT_CUA_CONNECTION || process.versions.electron),
          packaged: Boolean(process.env.NEXBOT_STATIC_DIR),
        }),
      );
    }

    if (method === "POST" && path === "/api/jobs") {
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      const botIds = Array.isArray(body.botIds) ? body.botIds.map(String) : [];
      if (!text || !botIds.length) return json(res, 400, { error: "text and botIds required" });
      const started: string[] = [];
      for (const id of botIds) {
        const b = store.bot(id);
        if (!b || b.busy || b.hidden) continue;
        if (isForbiddenFightAsk(null, b, text)) continue;
        appendHandoff({ from: null, to: { id: b.id, name: b.name, color: b.color }, text });
        // User-initiated: depth 0 so CoS can ask_bot once. Nested ask_bot still increments.
        await startTurn(id, `[Team job]\n\n${text}`).catch(() => {});
        started.push(id);
      }
      return json(res, 202, { started });
    }

    // identity handshake for the packaged app's port fallback: the forked
    // child proves it is OURS by echoing its pid (a stray dev server has
    // the same API shape but a different pid)
    if (method === "GET" && path === "/api/health") {
      return json(res, 200, { app: "nexbot", pid: process.pid, static: Boolean(STATIC_DIR) });
    }

    // ── provider instances (model picker) ──
    if (method === "GET" && path === "/api/instances") {
      return json(res, 200, { instances: await registry.describe() });
    }

    // ── app config (API keys — never echoed back, booleans only) ──
    if (method === "GET" && path === "/api/config") {
      return json(res, 200, configStatus(cfg));
    }
    if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
      const body = await readBody(req);
      const patch: Record<string, object> = {};
      for (const key of ["xai", "composio", "box", "profile"] as const) {
        if (body[key] && typeof body[key] === "object") patch[key] = body[key];
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
      saveConfig(patch);
      Object.assign(cfg, loadConfig());
      // provider keys change the fleet; a profile edit must not kill
      // in-flight turns with a pointless reload
      if (Object.keys(patch).some((k) => k !== "profile")) await reloadProviders();
      const status = configStatus(cfg);
      broadcast({ kind: "config", ...status });
      return json(res, 200, status);
    }

    // ── connectors (Composio) ──
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source } = await composio.listToolkits(cfg);
      return json(res, 200, { configured: Boolean(cfg.composio?.key), source, cards });
    }
    if (method === "GET" && path === "/api/connectors") {
      const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
      if (!cfg.composio?.key) return json(res, 200, { configured: false, services: {} });
      const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
      return json(res, 200, { configured: true, services: status });
    }
    m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
    if (m && method === "POST") return json(res, 200, await composio.authorizeService(cfg, m[1]));
    m = path.match(/^\/api\/connectors\/([\w-]+)$/);
    if (m && method === "DELETE") return json(res, 200, await composio.removeService(cfg, m[1]));

    // ── the bot's cloud computer (Box) ──
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
    if (m && method === "GET") return json(res, 200, await box.boxStatus(cfg, m[1]));
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
    if (m && method === "POST") {
      const botId = m[1];
      const bot = store.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      switch (m[2]) {
        case "provision":
          return json(res, 200, await box.provisionBox(cfg, botId, bot.name));
        case "join":
          return json(res, 200, await box.joinBox(cfg, botId));
        case "sleep":
          return json(res, 200, await box.sleepBox(cfg, botId));
        case "exec": {
          const body = await readBody(req);
          const command = String(body.command ?? "");
          if (isForbiddenSecretAccess({ command })) {
            return json(res, 400, { error: "blocked a request to read process environment secrets" });
          }
          return json(res, 200, await box.execOnBox(cfg, botId, command));
        }
        case "screenshot":
          return json(res, 200, await box.screenshotBox(cfg, botId));
      }
    }

    // packaged app: the server serves the built UI too (window → :8799 for
    // everything, no dev proxy to die). NEXBOT_STATIC_DIR is set by Electron.
    if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
      if (serveStatic(res, STATIC_DIR, path)) return;
    }

    return json(res, 404, { error: `no route: ${method} ${path}` });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    return json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
});

function groupMemberError(ids: string[]): string | null {
  if (ids.length < 2 || ids.length > 6) return "a group needs 2 to 6 teammates";
  for (const id of ids) {
    const member = store.bot(id);
    if (!member || member.kind === "group" || member.hidden) {
      return "members must be existing visible non-group bots";
    }
  }
  return null;
}

function headerSecret(req: IncomingMessage): string {
  const h = req.headers["x-nexbot-secret"];
  return Array.isArray(h) ? (h[0] ?? "") : (h ?? "");
}

function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function repoMatches(filter: string, body: { repository?: { full_name?: string } }): boolean {
  const name = String(body?.repository?.full_name ?? "");
  return name.toLowerCase() === filter.toLowerCase();
}

function fireRoutineEvent(r: { id: string; botId: string; name: string; prompt: string }, extra: string): boolean {
  const bot = store.bot(r.botId);
  if (!bot || bot.busy) return false;
  const text = `[Routine: ${r.name}]\n\n${r.prompt}\n\n${extra}`;
  markRan(r.id);
  rememberTurn(r.botId, text, "routine");
  void startTurn(r.botId, text, { commsDepth: 1 }).catch(() => {});
  broadcast({ kind: "routines", routines: listRoutines() });
  return true;
}

const fileWatchers = new Map<string, { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }>();

function closeFileWatch(id: string) {
  const row = fileWatchers.get(id);
  if (!row) return;
  if (row.timer) clearTimeout(row.timer);
  try {
    row.watcher.close();
  } catch {}
  fileWatchers.delete(id);
}

function syncFileWatches() {
  for (const id of [...fileWatchers.keys()]) closeFileWatch(id);
  for (const r of listRoutines()) {
    if (!r.enabled || r.kind !== "file" || !r.watchPath) continue;
    const watchPath = r.watchPath;
    if (!existsSync(watchPath)) continue;
    const routineId = r.id;
    try {
      const watcher = watch(watchPath, (_event, filename) => {
        const entry = fileWatchers.get(routineId);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          const current = listRoutines().find((x) => x.id === routineId);
          if (!current?.enabled || current.kind !== "file") return;
          const bot = store.bot(current.botId);
          if (!bot || bot.busy) return;
          const changed = filename ? String(filename) : watchPath;
          fireRoutineEvent(current, `File changed: ${changed}`);
        }, 400);
      });
      fileWatchers.set(routineId, { watcher });
    } catch {
      /* path missing or unwatchable */
    }
  }
}

function runDueRoutines() {
  for (const r of dueRoutines()) {
    const bot = store.bot(r.botId);
    if (!bot || bot.busy) continue;
    markRan(r.id);
    rememberTurn(r.botId, `[Routine: ${r.name}]\n\n${r.prompt}`, "routine");
    void startTurn(r.botId, `[Routine: ${r.name}]\n\n${r.prompt}`, { commsDepth: 1 }).catch(() => {});
    broadcast({ kind: "routines", routines: listRoutines() });
  }
}

function recoverAfterBoot() {
  runDueRoutines();
  for (const p of listPending()) {
    const bot = store.bot(p.botId);
    if (!bot || bot.busy) continue;
    void startTurn(p.botId, p.text, { replay: true }).catch(() => {});
  }
}

const BIND = process.env.NEXBOT_BIND || "127.0.0.1";
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(portBusyHint(PORT));
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
server.listen(PORT, BIND, () => {
  console.log(`nexbot server on http://${BIND}:${PORT}`);
  syncFileWatches();
  setTimeout(recoverAfterBoot, 2500);
});

setInterval(runDueRoutines, 30_000);
setInterval(() => {
  for (const row of watchdog.stuckBots()) {
    const bot = store.bot(row.botId);
    if (!bot?.busy) {
      watchdog.end(row.botId);
      continue;
    }
    broadcast({
      kind: "stuck",
      botId: bot.id,
      name: bot.name,
      body: `${bot.name} has made no progress. Work on this PC may be stuck.`,
    });
    store.patchBot(bot.id, { busy: false });
    forgetTurn(bot.id);
    turnGroup.delete(bot.id);
    void registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
    watchdog.end(bot.id);
  }
}, 10_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry.disposeAll().finally(() => process.exit(0));
  });
}
