// /api/internal/* — peer-agent comms surface. The agents-proxy (spawned
// inside a bot's agent process) calls these to discover peers and hand a
// message to one. Guarded by the per-boot COMMS_TOKEN; not part of the
// public API.
import { json, readBody } from "../http-util.ts";
import { applyTodoTool } from "../todo.ts";
import { searchMessages } from "../db.ts";
import {
  listMemoryFacts,
  saveMemoryFact,
  searchMemoryFacts,
} from "../memory-facts.ts";
import { credentialsForBot, revealGrantedCredential } from "../credentials.ts";
import { isForbiddenFightAsk } from "../roles.ts";
import { appendLog, MEMORY_FILE_MAX, readLog, readProfile, writeLog, writeProfile } from "../desk.ts";
import { parseTaskContext, isTaskDelegation } from "../task-context.ts";
import { ASK_BOT_STILL_WORKING } from "../comms-policy.ts";
import type { RouteArgs } from "./context.ts";
import { harness } from "./context.ts";

export async function handleInternalRoutes(args: RouteArgs): Promise<boolean> {
  const { req, res, method, path, url } = args;
  if (!path.startsWith("/api/internal/")) return false;
  const {
    store, broadcast, turnMeta, COMMS_TOKEN,
    askBotAndWait, appendHandoff, authorizeTaskDelegation,
    queueAgentMessage, drainAgentInbox, chiefOfStaffBot, triggerProactive,
  } = harness;

  if (req.headers.authorization !== `Bearer ${COMMS_TOKEN}`) {
    return json(res, 401, { error: "unauthorized" });
  }
  if (method === "GET" && path === "/api/internal/agents") {
    const self = url.searchParams.get("self");
    const bots = store.bots
      .filter((b) => b.id !== self && !b.hidden)
      .map((b) => ({
        id: b.id,
        name: b.name,
        title: b.title,
        description: b.description,
        enabledSkillSlugs: b.enabledSkillSlugs ?? [],
        model: b.modelSelection.model,
        busy: !!b.busy,
      }));
    return json(res, 200, { bots });
  }
  if (method === "POST" && path === "/api/internal/ask-bot") {
    const body = await readBody(req);
    const fromBotId = String(body.fromBotId ?? "").trim();
    const toBotId = String(body.toBotId ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
    const taskContext = parseTaskContext(body.taskContext);
    if (!fromBotId || !taskContext) return json(res, 400, { error: "a valid taskContext is required" });
    const target = store.bot(toBotId);
    if (!target || target.hidden) return json(res, 404, { error: "no such bot" });
    const from = store.bot(fromBotId);
    if (!from || from.hidden) return json(res, 404, { error: "no such sender bot" });
    if (target.busy || target.operatorControl) return json(res, 200, { busy: true, taskContext });
    if (isForbiddenFightAsk(from, target, message)) {
      return json(res, 200, {
        error: "Fight/challenge X cannot ask_bot X. Critique their existing output, or spawn a specialist.",
      });
    }
    const delegation = authorizeTaskDelegation(taskContext, from.id, target.id);
    if (!isTaskDelegation(delegation)) return json(res, 200, { error: delegation.error, taskContext });
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
    const reply = await askBotAndWait(fromBotId, toBotId, prefixed, delegation.child, {
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
    return json(res, 200, { botName: target.name, text: reply, taskContext: delegation.parent });
  }
  if (method === "POST" && path === "/api/internal/send-bot") {
    const body = await readBody(req);
    const fromBotId = String(body.fromBotId ?? "").trim();
    const toBotId = String(body.toBotId ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
    const taskContext = parseTaskContext(body.taskContext);
    if (!fromBotId || !taskContext) return json(res, 400, { error: "a valid taskContext is required" });
    const target = store.bot(toBotId);
    if (!target || target.hidden) return json(res, 404, { error: "no such bot" });
    const from = store.bot(fromBotId);
    if (!from || from.hidden) return json(res, 404, { error: "no such sender bot" });
    if (isForbiddenFightAsk(from, target, message)) {
      return json(res, 200, { error: "Fight/challenge X cannot ask_bot X. Critique their existing output, or spawn a specialist." });
    }
    const delegation = authorizeTaskDelegation(taskContext, from.id, target.id);
    if (!isTaskDelegation(delegation)) return json(res, 200, { error: delegation.error, taskContext });
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
        source: "agent",
        tool: { name: `sent @${target.name}: ${message.slice(0, 80)}` },
      });
      broadcast({ kind: "message", threadId: from.threadId, message: note });
      for (const g of store.bots.filter(
        (b) => b.kind === "group" && b.memberIds?.includes(from.id) && b.memberIds.includes(target.id),
      )) {
        const shared = store.appendMessage(g.threadId, {
          role: "bot",
          kind: "activity",
          source: "agent",
          tool: { name: `@${fromName} → @${target.name}` },
        });
        broadcast({ kind: "message", threadId: g.threadId, message: shared });
      }
    }
    const position = queueAgentMessage(target.id, { fromBotId: from.id, message, taskContext: delegation.child, at: Date.now() });
    drainAgentInbox(target.id);
    const cos = chiefOfStaffBot();
    if (cos && cos.id !== from?.id && cos.id !== target.id) {
      triggerProactive(cos.id, "task-queued", `@${fromName} queued work for @${target.name}: ${message.slice(0, 500)}`);
    }
    return json(res, 202, { queued: true, position, botName: target.name, busy: !!target.busy, taskContext: delegation.parent });
  }
  if (method === "POST" && path === "/api/internal/todos") {
    const body = await readBody(req);
    const botId = String(body.botId ?? "").trim();
    if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
    const result = applyTodoTool(botId, "items" in body ? { items: body.items as any[] } : {});
    return json(res, 200, result);
  }
  if (method === "GET" && path === "/api/internal/operator") {
    const botId = (url.searchParams.get("botId") ?? "").trim();
    const bot = store.bot(botId);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, { active: Boolean(bot.operatorControl) });
  }
  if (method === "GET" && path === "/api/internal/credentials") {
    const botId = (url.searchParams.get("botId") ?? "").trim();
    if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
    return json(res, 200, { credentials: credentialsForBot(botId) });
  }
  const internalCredential = path.match(/^\/api\/internal\/credentials\/([\w-]+)\/reveal$/);
  if (method === "GET" && internalCredential) {
    const botId = (url.searchParams.get("botId") ?? "").trim();
    if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
    const credential = revealGrantedCredential(internalCredential[1], botId);
    if (!credential) return json(res, 403, { error: "credential is not granted to this bot" });
    return json(res, 200, credential);
  }
  if (method === "GET" && path === "/api/internal/search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 10)));
    if (!q) return json(res, 400, { error: "q required" });
    const messageResults = searchMessages(q, limit).map((hit) => {
      const bot = hit.botId ? store.bot(hit.botId) : store.botByThread(hit.threadId);
      return { ...hit, botId: bot?.id ?? hit.botId, botName: bot?.name };
    });
    const factResults = searchMemoryFacts(q, { limit }).map((fact) => {
      const bot = store.bot(fact.botId);
      return {
        messageId: `memory:${fact.id}`,
        threadId: bot?.threadId ?? fact.botId,
        botId: fact.botId,
        botName: bot?.name,
        text: fact.fact,
        at: fact.sourceAt,
        provenance: { sourceType: fact.sourceType, sourceId: fact.sourceId, sourceAt: fact.sourceAt, confidence: fact.confidence },
      };
    });
    const results = [...factResults, ...messageResults].sort((a, b) => b.at - a.at).slice(0, limit);
    return json(res, 200, { results, retrieval: "structured-memory + transcript-fts" });
  }
  if (method === "GET" && path === "/api/internal/memory") {
    const botId = (url.searchParams.get("botId") ?? "").trim();
    if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
    const profile = readProfile(botId).trim();
    const log = readLog(botId).trim();
    const facts = listMemoryFacts(botId);
    const factText = facts.length
      ? facts.map((fact) => `- ${fact.fact} [${fact.sourceType}:${fact.sourceId}; ${new Date(fact.sourceAt).toISOString()}]`).join("\n")
      : "(empty)";
    const text = `# Memory for ${store.bot(botId)?.name ?? "Bot"}\n\n## Structured facts\n${factText}\n\n## profile.md\n${profile || "(empty)"}\n\n## Current Month Log\n${log || "(empty)"}`;
    return json(res, 200, { text, profile, log, facts });
  }
  if (method === "POST" && path === "/api/internal/memory") {
    const body = await readBody(req);
    const botId = String(body.botId ?? "").trim();
    const target = String(body.target ?? "log").trim();
    const content = String(body.content ?? "").trim();
    const mode = String(body.mode ?? (target === "log" ? "append" : "replace")).trim();
    if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
    if (!content) return json(res, 400, { error: "content required" });
    const sourceAt = Number.isFinite(Number(body.sourceAt)) ? Number(body.sourceAt) : Date.now();
    const currentJobId = turnMeta.get(botId)?.jobId;
    saveMemoryFact({
      botId,
      fact: content,
      kind: body.kind === "preference" || body.kind === "procedure" || body.kind === "event" ? body.kind : target === "log" ? "event" : "fact",
      sourceType: body.sourceType === "user" || body.sourceType === "tool" || body.sourceType === "import" || body.sourceType === "system" ? body.sourceType : "assistant",
      sourceId: String(body.sourceId ?? currentJobId ?? `memory:${Date.now()}`).slice(0, 240),
      sourceAt,
      validFrom: Number.isFinite(Number(body.validFrom)) ? Number(body.validFrom) : undefined,
      validUntil: Number.isFinite(Number(body.validUntil)) ? Number(body.validUntil) : undefined,
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 0.8,
    });

    if (target === "profile") {
      const current = mode === "append" ? readProfile(botId) : "";
      const next = mode === "append" ? (current ? `${current}\n\n${content}` : content) : content;
      if (next.length > MEMORY_FILE_MAX) {
        return json(res, 400, { error: `profile exceeds ${MEMORY_FILE_MAX} byte limit` });
      }
      writeProfile(botId, next);
      return json(res, 200, { text: `Updated profile.md (${next.length} bytes).` });
    } else if (target === "log") {
      const current = mode === "replace" ? "" : readLog(botId);
      const next = mode === "replace" ? content : (current ? `${current}\n\n- ${new Date().toISOString()}: ${content}` : `- ${new Date().toISOString()}: ${content}`);
      if (next.length > MEMORY_FILE_MAX) {
        return json(res, 400, { error: `log exceeds ${MEMORY_FILE_MAX} byte limit` });
      }
      if (mode === "replace") writeLog(botId, next);
      else appendLog(botId, `\n\n- ${new Date().toISOString()}: ${content}`);
      return json(res, 200, { text: `Saved to dated log (${next.length} bytes).` });
    } else {
      return json(res, 400, { error: "target must be 'profile' or 'log'" });
    }
  }
  return json(res, 404, { error: "unknown internal endpoint" });
}
