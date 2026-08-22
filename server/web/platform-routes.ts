// Platform surface: capabilities, jobs, health, receipts, doctor, search,
// feed, provider instances, app config, credential vault, and connectors.
import { json, readBody } from "../http-util.ts";
import { configStatus } from "../app-meta.ts";
import { defaultInstanceConfigs, loadConfig, saveConfig } from "../config.ts";
import { detectCapabilities } from "../capabilities.ts";
import { readCuaConnection } from "../cua-connection.ts";
import { getJob, listJobs } from "../jobs.ts";
import { listReceipts } from "../execution-evidence.ts";
import { doctorOverall, localDoctorChecks } from "../doctor.ts";
import { searchMessages } from "../db.ts";
import { searchMemoryFacts } from "../memory-facts.ts";
import { isForbiddenFightAsk } from "../roles.ts";
import { prepareReflexionPrompt } from "../recovery.ts";
import { listTodos } from "../todo.ts";
import { createCredential, deleteCredential, listCredentials, setCredentialGrants } from "../credentials.ts";
import * as composio from "../composio.ts";
import { queuedTurns } from "../turn-queue.ts";
import { requestIsLoopback } from "../harness-auth.ts";
import type { RouteArgs } from "./context.ts";
import { harness } from "./context.ts";

export async function handlePlatformRoutes(args: RouteArgs): Promise<boolean> {
  const { req, res, method, path, url } = args;
  if (
    !path.startsWith("/api/capabilities") &&
    !path.startsWith("/api/jobs") &&
    !path.startsWith("/api/health") &&
    !path.startsWith("/api/execution-receipts") &&
    !path.startsWith("/api/doctor") &&
    !path.startsWith("/api/search") &&
    !path.startsWith("/api/feed") &&
    !path.startsWith("/api/instances") &&
    !path.startsWith("/api/config") &&
    !path.startsWith("/api/credentials") &&
    !path.startsWith("/api/connectors")
  ) {
    return false;
  }
  const {
    store, registry, cfg, broadcast, watchdog,
    startTurn, appendHandoff, reloadProviders,
  } = harness;

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

  let m = path.match(/^\/api\/jobs\/([\w-]+)\/(resume|retry)$/);
  if (m && method === "POST") {
    const job = getJob(m[1]);
    if (!job) return json(res, 404, { error: "no such job" });
    const bot = store.bot(job.botId);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (bot.busy || bot.operatorControl) return json(res, 409, { error: "the bot is busy or under operator control" });
    const promptText = prepareReflexionPrompt(job, store);
    await startTurn(job.botId, promptText, {
      jobId: job.id,
      resume: m[2] === "resume",
      replay: true,
      source: job.source,
      taskContext: job.taskContext,
    });
    return json(res, 202, { ok: true, job: getJob(job.id) });
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
      // User-initiated task. Any active bot can delegate within its bounded scope.
      await startTurn(id, `[Team job]\n\n${text}`).catch(() => {});
      started.push(id);
    }
    return json(res, 202, { started });
  }
  if (method === "GET" && path === "/api/jobs") {
    const all = url.searchParams.get("all") === "1";
    return json(res, 200, {
      jobs: listJobs(all ? undefined : { statuses: ["running", "interrupted"] }).map((job) => ({
        ...job,
        botName: store.bot(job.botId)?.name ?? "Unknown bot",
      })),
    });
  }

  // identity handshake for the packaged app's port fallback: the forked
  // child proves it is OURS by echoing its pid (a stray dev server has
  // the same API shape but a different pid)
  if (method === "GET" && path === "/api/health") {
    return json(res, 200, { app: "nexbot", pid: process.pid, static: Boolean(harness.STATIC_DIR) });
  }
  if (method === "GET" && path === "/api/execution-receipts") {
    const botId = url.searchParams.get("botId") ?? undefined;
    const jobId = url.searchParams.get("jobId") ?? undefined;
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
    return json(res, 200, { receipts: listReceipts({ botId, jobId, limit }) });
  }
  if (method === "GET" && path === "/api/doctor") {
    const runningJobs = listJobs({ statuses: ["running"] });
    const queueCount = store.bots.reduce((count, bot) => count + queuedTurns(bot.id).length, 0);
    const checks = localDoctorChecks({ cuaReady: Boolean(readCuaConnection()), queuedTurns: queueCount, runningJobs: runningJobs.length });
    for (const instance of await registry.describe()) {
      checks.push({
        id: `provider:${instance.instanceId}`,
        status: instance.snapshot.state === "available" ? "pass" : "warn",
        detail: instance.snapshot.state === "available"
          ? `${instance.displayName ?? instance.instanceId} is available.`
          : `${instance.displayName ?? instance.instanceId}: ${instance.snapshot.reason ?? "unavailable"}`,
      });
    }
    return json(res, 200, { overall: doctorOverall(checks), checks, at: Date.now() });
  }
  if (method === "GET" && path === "/api/search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json(res, 400, { error: "q required" });
    const messages = searchMessages(q).map((hit) => {
      const bot = hit.botId ? store.bot(hit.botId) : store.botByThread(hit.threadId);
      return { ...hit, botId: bot?.id ?? hit.botId, botName: bot?.name };
    });
    const facts = searchMemoryFacts(q).map((fact) => ({
      messageId: `memory:${fact.id}`,
      threadId: store.bot(fact.botId)?.threadId ?? fact.botId,
      botId: fact.botId,
      botName: store.bot(fact.botId)?.name,
      text: fact.fact,
      at: fact.sourceAt,
      provenance: { sourceType: fact.sourceType, sourceId: fact.sourceId, confidence: fact.confidence },
    }));
    return json(res, 200, { results: [...facts, ...messages].sort((a, b) => b.at - a.at).slice(0, 100), retrieval: "structured-memory + transcript-fts" });
  }

  if (method === "GET" && path === "/api/feed") {
    const items: Array<{
      id: string;
      kind: "failed_routine" | "stuck_turn" | "pending_todo" | "unread_mention";
      botId: string;
      botName: string;
      title: string;
      detail: string;
      at: number;
      severity: "high" | "medium" | "low";
    }> = [];

    const stuckList = watchdog.stuckBots();
    for (const s of stuckList) {
      const bot = store.bot(s.botId);
      if (bot) {
        items.push({
          id: `stuck-${bot.id}-${s.startedAt}`,
          kind: "stuck_turn",
          botId: bot.id,
          botName: bot.name,
          title: `Turn stuck on @${bot.name}`,
          detail: `Active for ${Math.round((Date.now() - s.startedAt) / 1000)}s without events`,
          at: s.startedAt,
          severity: "high",
        });
      }
    }

    const stalledList = watchdog.stalledBots();
    for (const s of stalledList) {
      const bot = store.bot(s.botId);
      if (bot && !stuckList.some((st) => st.botId === bot.id)) {
        items.push({
          id: `stalled-${bot.id}-${s.startedAt}`,
          kind: "stuck_turn",
          botId: bot.id,
          botName: bot.name,
          title: `Stream stalled on @${bot.name}`,
          detail: `No tokens received for ${Math.round((Date.now() - (s.lastChunkAt || s.startedAt)) / 1000)}s`,
          at: s.lastChunkAt || s.startedAt,
          severity: "medium",
        });
      }
    }

    for (const bot of store.bots.filter((b) => !b.hidden)) {
      const todos = listTodos(bot.id);
      for (const td of todos) {
        if (td.status === "in_progress" || td.status === "pending") {
          items.push({
            id: `todo-${bot.id}-${td.id}`,
            kind: "pending_todo",
            botId: bot.id,
            botName: bot.name,
            title: td.status === "in_progress" ? `In-progress: ${td.content}` : `Pending: ${td.content}`,
            detail: `@${bot.name} todo item`,
            at: Date.now(),
            severity: td.status === "in_progress" ? "medium" : "low",
          });
        }
      }
    }

    for (const bot of store.bots.filter((b) => !b.hidden && b.unread)) {
      const messages = store.messagesFor(bot.threadId);
      const lastMsg = messages[messages.length - 1];
      items.push({
        id: `unread-${bot.id}`,
        kind: "unread_mention",
        botId: bot.id,
        botName: bot.name,
        title: `Unread message on @${bot.name}`,
        detail: lastMsg?.text ? lastMsg.text.slice(0, 80) : "New message",
        at: lastMsg?.at || Date.now(),
        severity: "medium",
      });
    }

    const failedRoutinesCount = items.filter((i) => i.kind === "failed_routine").length;
    const stuckTurnsCount = items.filter((i) => i.kind === "stuck_turn").length;
    const pendingTodosCount = items.filter((i) => i.kind === "pending_todo").length;
    const unreadCount = items.filter((i) => i.kind === "unread_mention").length;

    return json(res, 200, {
      summary: {
        total: items.length,
        failedRoutinesCount,
        stuckTurnsCount,
        pendingTodosCount,
        unreadCount,
      },
      items,
    });
  }

  // ── provider instances (model picker) ──
  if (method === "GET" && path === "/api/instances") {
    return json(res, 200, { instances: await registry.describe() });
  }
  if (method === "POST" && path === "/api/instances") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "provider setup is available on the host app only" });
    const body = await readBody(req);
    const instanceId = String(body.instanceId ?? "").trim();
    const cli = String(body.cli ?? "").trim();
    const cliArgs = Array.isArray(body.args) ? body.args.map(String) : String(body.args ?? "").split(/\s+/).filter(Boolean);
    const model = String(body.model ?? "default").trim() || "default";
    if (!/^[a-z][a-z0-9_-]{1,39}$/i.test(instanceId)) return json(res, 400, { error: "instanceId must use letters, numbers, dashes, or underscores" });
    if (!cli) return json(res, 400, { error: "CLI command required" });
    const instances = {
      ...(cfg.instances ?? defaultInstanceConfigs()),
      [instanceId]: {
        driver: "acp",
        displayName: String(body.displayName ?? instanceId).trim().slice(0, 80),
        config: {
          cli,
          args: cliArgs.slice(0, 40),
          model,
          workspace: typeof body.workspace === "string" ? body.workspace.trim() : undefined,
          authMethod: typeof body.authMethod === "string" ? body.authMethod.trim() : undefined,
          fullAuto: false,
        },
      },
    };
    saveConfig({ instances });
    Object.assign(cfg, loadConfig());
    await reloadProviders();
    return json(res, 201, { instances: await registry.describe() });
  }
  m = path.match(/^\/api\/instances\/([\w-]+)$/);
  if (m && method === "DELETE") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "provider setup is available on the host app only" });
    if (!cfg.instances?.[m[1]] || cfg.instances[m[1]].driver !== "acp") return json(res, 404, { error: "no custom ACP instance" });
    const instances = { ...cfg.instances };
    delete instances[m[1]];
    saveConfig({ instances });
    Object.assign(cfg, loadConfig());
    await reloadProviders();
    return json(res, 200, { instances: await registry.describe() });
  }

  // ── app config (API keys — never echoed back, booleans only) ──
  if (method === "GET" && path === "/api/config") {
    return json(res, 200, configStatus(cfg, harness.BIND));
  }
  if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
    const body = await readBody(req);
    const patch: Record<string, object> = {};
    for (const key of ["xai", "composio", "box", "profile", "remoteAccess"] as const) {
      if (body[key] && typeof body[key] === "object") patch[key] = body[key];
    }
    if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
    saveConfig(patch);
    Object.assign(cfg, loadConfig());
    // provider keys change the fleet; a profile edit must not kill
    // in-flight turns with a pointless reload
    if (Object.keys(patch).some((k) => k !== "profile")) await reloadProviders();
    const status = configStatus(cfg, harness.BIND);
    broadcast({ kind: "config", ...status });
    return json(res, 200, status);
  }

  // ── encrypted credential vault (host app only) ──
  if (path === "/api/credentials" && method === "GET") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
    return json(res, 200, { credentials: listCredentials() });
  }
  if (path === "/api/credentials" && method === "POST") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
    const body = await readBody(req);
    const botIds = Array.isArray(body.botIds) ? body.botIds.map(String).filter((id) => store.bot(id)) : [];
    try {
      const credential = createCredential({
        label: String(body.label ?? ""),
        envName: String(body.envName ?? ""),
        secret: String(body.secret ?? ""),
        botIds,
      });
      return json(res, 201, { credential });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  m = path.match(/^\/api\/credentials\/([\w-]+)$/);
  if (m && method === "PATCH") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
    const body = await readBody(req);
    const botIds = Array.isArray(body.botIds) ? body.botIds.map(String).filter((id) => store.bot(id)) : [];
    const credential = setCredentialGrants(m[1], botIds);
    return credential ? json(res, 200, { credential }) : json(res, 404, { error: "no such credential" });
  }
  if (m && method === "DELETE") {
    if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
    return deleteCredential(m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such credential" });
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

  return false;
}
