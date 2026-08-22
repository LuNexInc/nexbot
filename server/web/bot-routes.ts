// /api/bots* — roster CRUD, chat turns, cards, takeover, queue, preview,
// memory, todos, desk, and the per-bot computer surface. Plus the CoS
// onboarding endpoint.
import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

import { json, readBody } from "../http-util.ts";
import { EVENTS_DIR, NATIVE_DIR } from "../config.ts";
import type { NexColor } from "../store.ts";
import { applyTodoTool, listTodos } from "../todo.ts";
import {
  deskPath,
  ensureDesk,
  ensureMemory,
  inboxPath,
  memoryDir,
  MEMORY_FILE_MAX,
  readLog,
  readProfile,
  writeInboxFile,
  writeProfile,
  writeLog,
} from "../desk.ts";
import { deleteRoutinesForBot, listRoutines } from "../routines.ts";
import { persistAgentInbox } from "../agent-inbox.ts";
import { removeQueuedTurnsForBot, enqueueTurn, queuedTurns } from "../turn-queue.ts";
import { observeFrame } from "../execution-evidence.ts";
import { roleByTitle, teammateGreeting } from "../roles.ts";
import { createTaskContext } from "../task-context.ts";
import { preToolHook } from "../tool-hooks.ts";
import * as box from "../box.ts";
import type { Store } from "../store.ts";
import type { RouteArgs } from "./context.ts";
import { harness } from "./context.ts";

function groupMemberError(ids: string[], store: Store): string | null {
  if (ids.length < 2 || ids.length > 6) return "a group needs 2 to 6 teammates";
  for (const id of ids) {
    const member = store.bot(id);
    if (!member || member.kind === "group" || member.hidden) {
      return "members must be existing visible non-group bots";
    }
  }
  return null;
}

export async function handleBotRoutes(args: RouteArgs): Promise<boolean> {
  const { req, res, method, path } = args;
  if (!path.startsWith("/api/bots") && path !== "/api/onboarding/chief-of-staff") return false;
  const {
    store, registry, broadcast, screens, agentInbox, nonceCache,
    startTurn, stopActiveTurn, drainUserQueue, drainAgentInbox,
    defaultSelection, normalizeReasoningEffort, syncFileWatches, patchReceiptMessage,
  } = harness;
  const groupQueuedTurns = harness.groupQueuedTurns;

  // ── roster ──
  if (method === "GET" && path === "/api/bots") {
    return json(res, 200, {
      bots: store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId), todos: listTodos(b.id) })),
    });
  }
  let m = path.match(/^\/api\/bots\/([\w-]+)$/);
  if (method === "GET" && m) {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, { bot: { ...bot, messages: store.messagesFor(bot.threadId), todos: listTodos(bot.id) } });
  }
  if (method === "POST" && path === "/api/onboarding/chief-of-staff") {
    const body = await readBody(req).catch((): Record<string, unknown> => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const job = typeof body.job === "string" ? body.job.trim().slice(0, 500) : "";
    if (!name) return json(res, 400, { error: "Chief of Staff name required" });
    if (!job) return json(res, 400, { error: "Chief of Staff job required" });

    let bot = harness.chiefOfStaffBot();
    if (bot) {
      bot = store.patchBot(bot.id, { name, title: "Chief of Staff", description: job });
    } else {
      bot = store.createBot({
        name,
        title: "Chief of Staff",
        description: job,
        modelSelection: await defaultSelection(),
      });
    }
    if (!bot) return json(res, 500, { error: "could not set up Chief of Staff" });

    const messages = store.messagesFor(bot.threadId);
    const greeting = messages.find((message) => message.role === "bot" && message.kind === "text");
    if (greeting) {
      const patchedGreeting = store.patchMessage(bot.threadId, greeting.id, {
        text: teammateGreeting(name, job),
      });
      if (patchedGreeting) broadcast({ kind: "message.patch", threadId: bot.threadId, message: patchedGreeting });
    }
    const setupCard = messages.find(
      (message) => message.kind === "options" && /^What is this (?:NexBot|teammate)'s job\?$/.test(message.card?.title ?? ""),
    );
    if (setupCard?.card) {
      const patchedCard = store.patchMessage(bot.threadId, setupCard.id, {
        card: { ...setupCard.card, answered: job, dismissed: true },
      });
      if (patchedCard) broadcast({ kind: "message.patch", threadId: bot.threadId, message: patchedCard });
    }
    broadcast({ kind: "bot", bot });
    return json(res, 200, { bot: { ...bot, messages: store.messagesFor(bot.threadId) } });
  }
  if (method === "POST" && path === "/api/bots") {
    const body = await readBody(req).catch((): Record<string, unknown> => ({}));
    const kind = body.kind === "group" ? "group" : "bot";
    const color = typeof body.color === "string" && ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"].includes(body.color)
      ? body.color as NexColor
      : undefined;
    const memberIds: string[] = Array.isArray(body.memberIds)
      ? [...new Set((body.memberIds as unknown[]).map((id) => String(id)))]
      : [];
    if (kind === "group") {
      const invalid = groupMemberError(memberIds, store);
      if (invalid) return json(res, 400, { error: invalid });
    }
    let modelSelection = await defaultSelection();
    const requested = body.modelSelection as { instanceId?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined;
    if (requested && typeof requested === "object") {
      const instanceId = typeof requested.instanceId === "string" ? requested.instanceId : "";
      const model = typeof requested.model === "string" ? requested.model : "";
      const instance = (await registry.describe()).find((item) => item.instanceId === instanceId);
      if (!instance || instance.snapshot.state !== "available") {
        return json(res, 400, { error: "selected provider is unavailable" });
      }
      if (!instance.models.options.some((option) => option.id === model)) {
        return json(res, 400, { error: "selected model is unavailable" });
      }
      const reasoningEffort = requested.reasoningEffort === undefined ? undefined : normalizeReasoningEffort(requested.reasoningEffort);
      if (requested.reasoningEffort !== undefined && !reasoningEffort) {
        return json(res, 400, { error: "reasoningEffort must be auto, low, medium, high, or max" });
      }
      modelSelection = { instanceId, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
    }
    const bot = store.createBot({
      kind,
      name: typeof body.name === "string" ? body.name : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      personality: typeof body.personality === "string" ? body.personality : undefined,
      color,
      memberIds,
      modelSelection,
    });
    const created = store.bot(bot.id)!;
    broadcast({ kind: "bot", bot: created });
    return json(res, 201, { bot: { ...created, messages: store.messagesFor(bot.threadId) } });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)$/);
  if (m && method === "PATCH") {
    const existing = store.bot(m[1]);
    if (!existing) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req);
    if (body.kind !== undefined && body.kind !== existing.kind) {
      return json(res, 400, { error: "kind cannot be changed" });
    }
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "title", "description", "personality", "notifications", "modelSelection", "unread", "computer", "color", "mascotExpression", "pinned", "hidden", "memoryEnabled", "enabledSkillSlugs", "memberIds", "proactiveEnabled", "completionPings", "sortOrder", "operatorControl"] as const) {
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
      const invalid = groupMemberError(ids, store);
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
    removeQueuedTurnsForBot(bot.id);
    agentInbox.delete(bot.id);
    persistAgentInbox(agentInbox);
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
        ...(typeof body.answered === "string" ? { answered: body.answered } : {}),
        ...(typeof body.dismissed === "boolean" ? { dismissed: body.dismissed } : {}),
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
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const clientNonce = typeof body.clientNonce === "string" ? body.clientNonce.trim() : undefined;
    if (clientNonce && nonceCache.isDuplicate(m[1], clientNonce)) {
      return json(res, 200, { ok: true, duplicate: true });
    }
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
    const delivery = body.delivery === "steer" || body.delivery === "replace" ? body.delivery : "queue";
    if (!registry.get(bot.modelSelection.instanceId)) {
      const fallback = await defaultSelection();
      if (!registry.get(fallback.instanceId)) {
        return json(res, 409, { error: "No AI provider is ready: the selected provider is unavailable." });
      }
    }
    nonceCache.record(m[1], clientNonce);
    if (bot.busy || bot.operatorControl) {
      if (delivery === "replace") {
        if (bot.operatorControl) {
          nonceCache.forget(m[1], clientNonce);
          return json(res, 409, { error: "operator takeover is active — release control before replacing the turn" });
        }
        await stopActiveTurn(bot.id, "turn replaced by the user");
      } else {
        const pending = store.appendMessage(bot.threadId, {
          role: "user",
          kind: "text",
          text,
          clientNonce,
          source: "user",
          status: "pending",
        });
        broadcast({ kind: "message", threadId: bot.threadId, message: pending });
        const queued = enqueueTurn({ botId: bot.id, text, messageId: pending.id, clientNonce, delivery });
        return json(res, 202, { ok: true, queued: true, delivery, queueId: queued.id, position: queuedTurns(bot.id).findIndex((row) => row.id === queued.id) + 1, clientNonce });
      }
    }
    try {
      await startTurn(m[1], text, { clientNonce });
    } catch (err) {
      nonceCache.forget(m[1], clientNonce);
      throw err;
    }
    return json(res, 202, { ok: true, clientNonce });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
  if (m && method === "POST") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req);
    const instance = registry.get(bot.modelSelection.instanceId);
    if (!instance) return json(res, 409, { error: "provider unavailable" });
    await instance.adapter.respondToRequest(bot.threadId, String(body.requestId), {
      behavior: body.behavior === "allow" || body.behavior === "deny" || body.behavior === "answer" ? body.behavior : "answer",
      message: typeof body.message === "string" ? body.message : undefined,
    });
    return json(res, 200, { ok: true });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
  if (m && method === "POST") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    await stopActiveTurn(bot.id, "turn interrupted by the user");
    if (queuedTurns(bot.id).length > 0) setTimeout(() => drainUserQueue(bot.id), 50);
    else setTimeout(() => drainAgentInbox(bot.id), 50);
    return json(res, 200, { ok: true });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/takeover$/);
  if (m && (method === "POST" || method === "DELETE")) {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const body: Record<string, unknown> = method === "POST" ? await readBody(req).catch(() => ({})) : {};
    const active = method === "POST" ? body.active !== false : false;
    if (active && bot.busy) await stopActiveTurn(bot.id, "operator takeover");
    const updated = store.patchBot(bot.id, { operatorControl: active });
    broadcast({ kind: "bot", bot: updated });
    if (!active) {
      setTimeout(() => {
        if (queuedTurns(bot.id).length > 0) return drainUserQueue(bot.id);
        const groupQueue = groupQueuedTurns.get(bot.id);
        if (groupQueue?.length) {
          groupQueuedTurns.delete(bot.id);
          const mergedText = groupQueue.map((item) => item.text).join("\n\n---\n\n");
          void startTurn(bot.id, mergedText, { taskContext: createTaskContext(bot.id), source: "agent", groupId: groupQueue[0]?.groupId }).catch(() => {});
          return;
        }
        drainAgentInbox(bot.id);
      }, 50);
    }
    return json(res, 200, { ok: true, active });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/queue$/);
  if (m && method === "GET") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, { turns: queuedTurns(bot.id) });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/preview$/);
  if (m && method === "POST") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req);
    const png = String(body.png ?? "");
    if (!png) return json(res, 400, { error: "png required" });
    for (const receipt of observeFrame(bot.id, png)) patchReceiptMessage(receipt);
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
    const baseHash = createHash("sha256").update(profile + "\n" + log).digest("hex");
    res.setHeader("etag", `"${baseHash}"`);
    return json(res, 200, {
      enabled: Boolean(bot.memoryEnabled),
      profile,
      log,
      text: profile,
      baseHash,
      dir: memoryDir(bot.id),
      desk: deskPath(bot.id),
    });
  }
  if (m && method === "PUT") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    ensureMemory(bot.id);
    const currentProfile = readProfile(bot.id);
    const currentLog = readLog(bot.id);
    const currentHash = createHash("sha256").update(currentProfile + "\n" + currentLog).digest("hex");

    const body = await readBody(req);
    const ifMatch = typeof req.headers["if-match"] === "string" ? req.headers["if-match"].replace(/^"|"$/g, "") : undefined;
    const providedHash = typeof body.baseHash === "string" ? body.baseHash : ifMatch;

    if (providedHash && providedHash !== currentHash) {
      return json(res, 409, {
        error: "memory was modified by another turn — reload before saving (CAS conflict)",
        currentHash,
      });
    }

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
    const nextHash = createHash("sha256").update(profile + "\n" + log).digest("hex");
    res.setHeader("etag", `"${nextHash}"`);
    return json(res, 200, {
      enabled: Boolean(next.memoryEnabled),
      profile,
      log,
      text: profile,
      baseHash: nextHash,
      dir: memoryDir(bot.id),
      desk: deskPath(bot.id),
    });
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/todos$/);
  if (m && method === "GET") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, { items: listTodos(bot.id) });
  }
  if (m && method === "PUT") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const body = await readBody(req);
    const result = applyTodoTool(bot.id, { items: Array.isArray(body.items) ? body.items : [] });
    return json(res, result.isError ? 400 : 200, result);
  }
  m = path.match(/^\/api\/bots\/([\w-]+)\/desk$/);
  if (m && method === "GET") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, { path: ensureDesk(bot.id) });
  }

  // ── the bot's cloud computer (Box) ──
  m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
  if (m && method === "GET") return json(res, 200, await box.boxStatus(harness.cfg, m[1]));
  m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
  if (m && method === "POST") {
    const botId = m[1];
    const bot = store.bot(botId);
    if (!bot) return json(res, 404, { error: "no such bot" });
    switch (m[2]) {
      case "provision":
        return json(res, 200, await box.provisionBox(harness.cfg, botId, bot.name));
      case "join":
        return json(res, 200, await box.joinBox(harness.cfg, botId));
      case "sleep":
        return json(res, 200, await box.sleepBox(harness.cfg, botId));
      case "exec": {
        const body = await readBody(req);
        const command = String(body.command ?? "");
        const hook = preToolHook({ name: "computer_exec", command });
        if (!hook.allow) {
          return json(res, 400, { error: hook.reason ?? "blocked a request to read process environment secrets" });
        }
        return json(res, 200, await box.execOnBox(harness.cfg, botId, command));
      }
      case "screenshot":
        return json(res, 200, await box.screenshotBox(harness.cfg, botId));
    }
  }
  return false;
}
