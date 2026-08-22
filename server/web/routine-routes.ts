// /api/routines* (cron, webhook, file-watch), /api/webhooks/github, and
// /api/skills*. Webhook routes keep their own secret checks because they are
// public harness paths.
import { json, readBody, headerSecret, secretsMatch, repoMatches } from "../http-util.ts";
import {
  createRoutine,
  createRoutineFromTurn,
  deleteRoutine,
  listRoutines,
  normalizeRoutineKind,
  patchRoutine,
  routineCreateError,
  routineHookPath,
} from "../routines.ts";
import { deleteSkill, listSkills, saveSkill, skillFromTurn } from "../skills.ts";
import type { RouteArgs } from "./context.ts";
import { harness } from "./context.ts";

export async function handleRoutineRoutes(args: RouteArgs): Promise<boolean> {
  const { req, res, method, path, url } = args;
  if (
    !path.startsWith("/api/routines") &&
    !path.startsWith("/api/webhooks/") &&
    !path.startsWith("/api/skills")
  ) {
    return false;
  }
  const { store, broadcast, fireRoutineEvent, syncFileWatches } = harness;

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
    const hookUrl = kind === "webhook" ? `http://127.0.0.1:${harness.PORT}${routineHookPath(routine.id)}` : undefined;
    return json(res, 201, { routine, hookUrl });
  }
  if (method === "POST" && path === "/api/routines/from-thread") {
    const body = await readBody(req);
    const threadId = String(body.threadId ?? "");
    const bot = store.botByThread(threadId) || (body.botId ? store.bot(String(body.botId)) : null);
    if (!bot) return json(res, 400, { error: "bot or thread not found" });
    const msgs = store.messagesFor(bot.threadId);
    const lastUser = [...msgs].reverse().find((msg) => msg.role === "user" && msg.kind === "text")?.text;
    const prompt = String(body.prompt ?? lastUser ?? "").trim();
    if (!prompt) return json(res, 400, { error: "prompt or user turn required" });
    const onComplete =
      body.onComplete && typeof body.onComplete === "object" && typeof (body.onComplete as any).targetBotId === "string"
        ? {
            targetBotId: String((body.onComplete as any).targetBotId),
            messageTemplate: typeof (body.onComplete as any).messageTemplate === "string" ? String((body.onComplete as any).messageTemplate) : undefined,
          }
        : undefined;
    const routine = createRoutineFromTurn({
      botId: bot.id,
      name: String(body.name ?? prompt.slice(0, 50)).trim(),
      prompt,
      dailyAt: typeof body.dailyAt === "string" ? body.dailyAt : "08:00",
      everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : undefined,
      weekdaysOnly: Boolean(body.weekdaysOnly),
      onComplete,
      maxTokens: body.maxTokens ? Number(body.maxTokens) : undefined,
    });
    broadcast({ kind: "routines", routines: listRoutines() });
    return json(res, 201, { routine });
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
  let m = path.match(/^\/api\/routines\/hooks\/([\w-]+)$/);
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
    const routineId = m[1];
    const existing = listRoutines().find((row) => row.id === routineId);
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
    const userText = [...msgs].reverse().find((msg) => msg.role === "user" && msg.kind === "text")?.text ?? "";
    const assistantText = [...msgs].reverse().find((msg) => msg.role === "bot" && msg.kind === "text")?.text ?? "";
    const toolNames = msgs.filter((msg) => msg.kind === "activity" && msg.tool?.name).map((msg) => msg.tool!.name);
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
  return false;
}
