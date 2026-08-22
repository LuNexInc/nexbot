// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. The config pins one deliberately-unknown driver so the
// suite is deterministic with or without agent CLIs installed — and pins
// the shadow-instance behavior end to end while it's at it.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const WIPE_PASSWORD = `wipe-${Math.random().toString(36).slice(2)}`;

let child: ChildProcess;
let home: string;
let stderr = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "nexbot-api-test-"));
  // a fleet of exactly one unknown driver: no CLI probes, no network
  mkdirSync(join(home, ".nexbot"), { recursive: true });
  writeFileSync(
    join(home, ".nexbot", "config.json"),
    JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );

  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      NEXBOT_PORT: String(PORT),
      NEXBOT_WIPE_PASSWORD: WIPE_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (c) => (stderr += c));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}, 30_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on("close", () => resolve());
    setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("harness HTTP API", () => {
  it("identifies itself on /api/health", async () => {
    const { status, body } = await api("GET", "/api/health");
    expect(status).toBe(200);
    expect(body.app).toBe("nexbot");
    expect(typeof body.pid).toBe("number");
  });

  it("lists durable jobs that need recovery", async () => {
    const { status, body } = await api("GET", "/api/jobs");
    expect(status).toBe(200);
    expect(body.jobs).toEqual([]);
  });

  it("seeds one starter bot with its greeting", async () => {
    const { status, body } = await api("GET", "/api/bots");
    expect(status).toBe(200);
    expect(body.bots.length).toBeGreaterThanOrEqual(1);
    expect(body.bots[0].messages.length).toBeGreaterThanOrEqual(2);
  });

  it("reads one bot and its thread without listing every transcript", async () => {
    const list = await api("GET", "/api/bots");
    const botId = list.body.bots[0].id;
    const { status, body } = await api("GET", `/api/bots/${botId}`);
    expect(status).toBe(200);
    expect(body.bot.id).toBe(botId);
    expect(Array.isArray(body.bot.messages)).toBe(true);
  });

  it("sets up the seeded Chief of Staff from onboarding", async () => {
    const before = await api("GET", "/api/bots");
    const cos = before.body.bots.find((b: { name: string; title?: string }) => /chief of staff/i.test(`${b.name} ${b.title ?? ""}`));
    expect(cos).toBeTruthy();

    const setup = await api("POST", "/api/onboarding/chief-of-staff", {
      name: "Luna",
      job: "Keep my projects and priorities moving",
    });
    expect(setup.status).toBe(200);
    expect(setup.body.bot).toMatchObject({
      id: cos.id,
      name: "Luna",
      title: "Chief of Staff",
      description: "Keep my projects and priorities moving",
    });
    expect(setup.body.bot.messages[0].text).toContain("My job is Keep my projects and priorities moving.");
    expect(setup.body.bot.messages[1].card).toMatchObject({
      dismissed: true,
      answered: "Keep my projects and priorities moving",
    });

    const restored = await api("PATCH", `/api/bots/${cos.id}`, {
      name: "Chief of Staff",
      title: "Manages the desk",
      description: "Manages your other bots and pulls you in for decisions.",
    });
    expect(restored.status).toBe(200);
  });

  it("describes the configured fleet, shadows included", async () => {
    const { status, body } = await api("GET", "/api/instances");
    expect(status).toBe(200);
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toMatchObject({
      instanceId: "ghost",
      driverKind: "not-a-real-driver",
      displayName: "Ghost",
      snapshot: { state: "unavailable" },
    });
    expect(body.instances[0].snapshot.reason).toContain("not-a-real-driver");
  });

  it("creates, patches, and deletes a bot", async () => {
    const created = await api("POST", "/api/bots");
    expect(created.status).toBe(201);
    const bot = created.body.bot;

    const patched = await api("PATCH", `/api/bots/${bot.id}`, { name: "Renamed", pinned: true, enabledSkillSlugs: ["alpha"] });
    expect(patched.status).toBe(200);
    expect(patched.body.bot).toMatchObject({ name: "Renamed", pinned: true, enabledSkillSlugs: ["alpha"] });
    const cleared = await api("PATCH", `/api/bots/${bot.id}`, { enabledSkillSlugs: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.bot.enabledSkillSlugs).toBeNull();

    const missing = await api("PATCH", "/api/bots/does-not-exist", { name: "x" });
    expect(missing.status).toBe(404);

    const deleted = await api("DELETE", `/api/bots/${bot.id}`);
    expect(deleted.status).toBe(200);
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === bot.id)).toBeUndefined();
  });

  it("PATCH cannot mint a second Chief of Staff", async () => {
    const list = await api("GET", "/api/bots");
    const isCos = (b: { kind?: string; name: string; title?: string }) =>
      b.kind !== "group" &&
      (/^(luna|chief of staff)$/i.test(b.name) || /chief of staff/i.test(b.title ?? ""));
    expect(list.body.bots.filter(isCos)).toHaveLength(1);

    const created = await api("POST", "/api/bots", { name: "PatchProbe", title: "Ops" });
    expect(created.status).toBe(201);
    const id = created.body.bot.id;

    const asName = await api("PATCH", `/api/bots/${id}`, { name: "Chief of Staff" });
    expect(asName.status).toBe(200);
    expect(asName.body.bot.name).toBe("Specialist");

    const asLuna = await api("PATCH", `/api/bots/${id}`, { name: "Luna" });
    expect(asLuna.status).toBe(200);
    expect(asLuna.body.bot.name).toBe("Specialist");

    const asTitle = await api("PATCH", `/api/bots/${id}`, { title: "Deputy Chief of Staff" });
    expect(asTitle.status).toBe(200);
    expect(asTitle.body.bot.title).toBe("Specialist");

    const after = await api("GET", "/api/bots");
    expect(after.body.bots.filter(isCos)).toHaveLength(1);

    await api("DELETE", `/api/bots/${id}`);
  });

  it("DELETE refuses the last Chief of Staff with 409", async () => {
    const list = await api("GET", "/api/bots");
    const isCos = (b: { kind?: string; name: string; title?: string }) =>
      b.kind !== "group" &&
      (/^(luna|chief of staff)$/i.test(b.name) || /chief of staff/i.test(b.title ?? ""));
    const cos = list.body.bots.find(isCos);
    expect(cos).toBeTruthy();
    const refused = await api("DELETE", `/api/bots/${cos.id}`);
    expect(refused.status).toBe(409);
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === cos.id)).toBeTruthy();
  });

  it("PATCH refuses hiding the last Chief of Staff; user chat to a hidden specialist still runs", async () => {
    const list = await api("GET", "/api/bots");
    const isCos = (b: { kind?: string; name: string; title?: string }) =>
      b.kind !== "group" &&
      (/^(luna|chief of staff)$/i.test(b.name) || /chief of staff/i.test(b.title ?? ""));
    const cos = list.body.bots.find(isCos);
    expect(cos).toBeTruthy();
    const hideCos = await api("PATCH", `/api/bots/${cos.id}`, { hidden: true });
    expect(hideCos.status).toBe(400);
    expect(hideCos.body.error).toMatch(/cannot hide the Chief of Staff/i);
    const still = await api("GET", "/api/bots");
    expect(still.body.bots.find((b: { id: string }) => b.id === cos.id).hidden).toBeFalsy();

    const created = await api("POST", "/api/bots", { name: "HideChat", title: "Ops" });
    const id = created.body.bot.id;
    const hid = await api("PATCH", `/api/bots/${id}`, { hidden: true });
    expect(hid.status).toBe(200);
    expect(hid.body.bot.hidden).toBe(true);
    const chat = await api("POST", `/api/bots/${id}/messages`, { text: "still there" });
    expect(chat.status).not.toBe(404);
    await api("DELETE", `/api/bots/${id}`);
  });

  it("DELETE a specialist drops its routines and still 200s", async () => {
    const created = await api("POST", "/api/bots", { name: "RoutineProbe", title: "Ops" });
    expect(created.status).toBe(201);
    const id = created.body.bot.id;
    const routine = await api("POST", "/api/routines", {
      botId: id,
      name: "orphan-me",
      prompt: "should die with the bot",
      everyMinutes: 15,
    });
    expect(routine.status).toBe(201);
    const deleted = await api("DELETE", `/api/bots/${id}`);
    expect(deleted.status).toBe(200);
    const left = await api("GET", `/api/routines?botId=${id}`);
    expect(left.body.routines).toEqual([]);
  });

  it("POST group named Chief of Staff is demoted; PATCH kind is 400", async () => {
    const a = await api("POST", "/api/bots", { name: "G1", title: "Ops" });
    const b = await api("POST", "/api/bots", { name: "G2", title: "Ops" });
    const group = await api("POST", "/api/bots", {
      kind: "group",
      name: "Chief of Staff",
      memberIds: [a.body.bot.id, b.body.bot.id],
    });
    expect(group.status).toBe(201);
    expect(group.body.bot.name).toBe("Specialist");
    expect(group.body.bot.kind).toBe("group");

    const asKind = await api("PATCH", `/api/bots/${a.body.bot.id}`, { kind: "group" });
    expect(asKind.status).toBe(400);

    await api("DELETE", `/api/bots/${group.body.bot.id}`);
    await api("DELETE", `/api/bots/${a.body.bot.id}`);
    await api("DELETE", `/api/bots/${b.body.bot.id}`);
  });

  it("POST create broadcasts kind bot to SSE subscribers", async () => {
    const ac = new AbortController();
    const res = await fetch(`${BASE}/api/events`, { signal: ac.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
      }
    })();
    const waitFor = async (needle: string, ms: number) => {
      const t0 = Date.now();
      while (!buf.includes(needle)) {
        if (Date.now() - t0 > ms) throw new Error(`no ${needle} in ${ms}ms. got:\n${buf}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    await waitFor('"kind":"hello"', 2_000);
    const created = await api("POST", "/api/bots", { name: "SseProbe" });
    expect(created.status).toBe(201);
    await waitFor('"kind":"bot"', 3_000);
    expect(buf).toContain(created.body.bot.id);
    expect(buf).toContain("SseProbe");
    ac.abort();
    await pump.catch(() => {});
  });

  it("persists an answered onboarding card", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const card = bot.messages.find((m: { kind: string }) => m.kind === "options");
    const res = await api("PATCH", `/api/bots/${bot.id}/cards/${card.id}`, { answered: card.card.options[0] });
    expect(res.status).toBe(200);
    expect(res.body.message.card.answered).toBe(card.card.options[0]);
  });

  it("rejects an empty message and explains an unavailable provider", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];

    const empty = await api("POST", `/api/bots/${bot.id}/messages`, { text: "   " });
    expect(empty.status).toBe(400);

    // the seeded bot's selection points at the ghost instance — sending a
    // real message must fail loudly, not 202-and-hang
    const send = await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello?" });
    expect(send.status).toBe(409);
    expect(send.body.error).toContain("signed in");
  });

  it("saves config keys write-only and reports booleans", async () => {
    const meta = await api("GET", "/api/config");
    expect(meta.body.dataDir).toBeTruthy();
    expect(typeof meta.body.version).toBe("string");
    expect(typeof meta.body.platform).toBe("string");

    const before = await api("GET", "/api/config");
    expect(before.body.box).toEqual({ configured: false });

    const put = await api("PUT", "/api/config", { box: { token: "tok_secret_value" } });
    expect(put.status).toBe(200);
    expect(put.body.box).toEqual({ configured: true });
    expect(JSON.stringify(put.body)).not.toContain("tok_secret_value");

    const after = await api("GET", "/api/config");
    expect(after.body.box).toEqual({ configured: true });
    expect(JSON.stringify(after.body)).not.toContain("tok_secret_value");

    const onDisk = JSON.parse(
      (await import("node:fs")).readFileSync(join(home, ".nexbot", "config.json"), "utf8"),
    );
    expect(JSON.stringify(onDisk)).not.toContain("tok_secret_value");
    expect(onDisk.box?.token?.__nex).toBe(1);

    const cleared = await api("PUT", "/api/config", { box: { token: "" } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.box).toEqual({ configured: false });

    const nothing = await api("PUT", "/api/config", {});
    expect(nothing.status).toBe(400);
  });

  it("stores and echoes the user profile (not write-only, unlike keys)", async () => {
    const put = await api("PUT", "/api/config", { profile: { name: "Ada Lovelace", email: "Ada@Example.com" } });
    expect(put.status).toBe(200);
    expect(put.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });

    const after = await api("GET", "/api/config");
    expect(after.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });
  });

  it("saves a skill from a named draft and lists it", async () => {
    const created = await api("POST", "/api/skills", {
      name: "File invoices",
      description: "Put PDFs in the desk out folder",
    });
    expect(created.status).toBe(201);
    expect(created.body.skill.valid).toBe(true);
    const listed = await api("GET", "/api/skills");
    expect(listed.body.skills.some((s: { slug: string }) => s.slug === "file-invoices")).toBe(true);
  });

  it("rejects a group with one member and creates a 2-bot group", async () => {
    const a = await api("POST", "/api/bots", { name: "Alpha", title: "Inbox" });
    const b = await api("POST", "/api/bots", { name: "Beta", title: "Research" });
    const bad = await api("POST", "/api/bots", { kind: "group", name: "Solo", memberIds: [a.body.bot.id] });
    expect(bad.status).toBe(400);
    const group = await api("POST", "/api/bots", {
      kind: "group",
      name: "War room",
      memberIds: [a.body.bot.id, b.body.bot.id],
    });
    expect(group.status).toBe(201);
    expect(group.body.bot.kind).toBe("group");
    expect(group.body.bot.memberIds).toHaveLength(2);

    const c = await api("POST", "/api/bots", { name: "Gamma", title: "Ops" });
    const added = await api("PATCH", `/api/bots/${group.body.bot.id}`, {
      memberIds: [a.body.bot.id, b.body.bot.id, c.body.bot.id],
    });
    expect(added.status).toBe(200);
    expect(added.body.bot.memberIds).toHaveLength(3);

    const tooFew = await api("PATCH", `/api/bots/${group.body.bot.id}`, {
      memberIds: [a.body.bot.id],
    });
    expect(tooFew.status).toBe(400);

    const onBot = await api("PATCH", `/api/bots/${a.body.bot.id}`, {
      memberIds: [b.body.bot.id, c.body.bot.id],
    });
    expect(onBot.status).toBe(400);

    const nested = await api("PATCH", `/api/bots/${group.body.bot.id}`, {
      memberIds: [a.body.bot.id, group.body.bot.id],
    });
    expect(nested.status).toBe(400);
  });

  it("issues a steer token and rejects a bad one", async () => {
    const got = await api("GET", "/api/steer");
    expect(got.status).toBe(200);
    expect(got.body.token).toMatch(/^[0-9a-f]{48}$/);
    expect(got.body.path).toBe(`/m.html#token=${got.body.token}`);
    const denied = await fetch(`${BASE}/api/steer/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: JSON.stringify({ text: "hi", botIds: ["x"] }),
    });
    expect(denied.status).toBe(401);
  });

  it("lists steer bots only with the steer token", async () => {
    const created = await api("POST", "/api/bots", { name: "PhoneBot", title: "Ops" });
    const deniedBots = await fetch(`${BASE}/api/steer/bots`);
    expect(deniedBots.status).toBe(401);
    const tok = (await api("GET", "/api/steer")).body.token;
    const ok = await fetch(`${BASE}/api/steer/bots?token=${tok}`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { bots: Array<{ name: string }> };
    expect(body.bots.some((b) => b.name === "PhoneBot")).toBe(true);
    await api("DELETE", `/api/bots/${created.body.bot.id}`);
  });

  it("reports capabilities without claiming CUA from the platform", async () => {
    const { status, body } = await api("GET", "/api/capabilities");
    expect(status).toBe(200);
    expect(body.localComputer.available).toBe(false);
    expect(body.host.platform).toBeTruthy();
  });

  it("interrupt returns 200 and clears busy even with no live provider turn", async () => {
    const created = await api("POST", "/api/bots");
    const bot = created.body.bot;
    const res = await api("POST", `/api/bots/${bot.id}/interrupt`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const listed = await api("GET", "/api/bots");
    const after = listed.body.bots.find((b: { id: string }) => b.id === bot.id);
    expect(after?.busy).toBeFalsy();
  });

  it("404s unknown routes with the route in the error", async () => {
    const res = await api("GET", "/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/definitely-not-a-route");
  });

  it("POST /api/routines 400s invalid file-watch and dailyAt, keeps valid creates", async () => {
    const { body } = await api("GET", "/api/bots");
    const botId = body.bots[0].id;
    const base = { botId, name: "r", prompt: "do the thing" };

    const noPath = await api("POST", "/api/routines", { ...base, kind: "file" });
    expect(noPath.status).toBe(400);

    const emptyPath = await api("POST", "/api/routines", { ...base, kind: "file", watchPath: "" });
    expect(emptyPath.status).toBe(400);

    const fileWatch = await api("POST", "/api/routines", { ...base, kind: "file-watch" });
    expect(fileWatch.status).toBe(400);

    const badTime = await api("POST", "/api/routines", { ...base, dailyAt: "not-a-time" });
    expect(badTime.status).toBe(400);

    const oob = await api("POST", "/api/routines", { ...base, dailyAt: "25:99" });
    expect(oob.status).toBe(400);

    const okDaily = await api("POST", "/api/routines", {
      ...base,
      name: "morning",
      dailyAt: "09:00",
      weekdaysOnly: true,
    });
    expect(okDaily.status).toBe(201);
    expect(okDaily.body.routine).toMatchObject({ dailyAt: "09:00", weekdaysOnly: true });

    const okHook = await api("POST", "/api/routines", {
      ...base,
      name: "hook",
      kind: "webhook",
      webhookSecret: "s3cret",
    });
    expect(okHook.status).toBe(201);
    expect(okHook.body.routine.kind).toBe("webhook");

    const okFile = await api("POST", "/api/routines", {
      ...base,
      name: "watch",
      kind: "file",
      watchPath: home,
    });
    expect(okFile.status).toBe(201);
    expect(okFile.body.routine).toMatchObject({ kind: "file", watchPath: home });

    const noSecret = await api("POST", "/api/routines", { ...base, kind: "webhook" });
    expect(noSecret.status).toBe(400);

    const escape = await api("POST", "/api/routines", {
      ...base,
      kind: "file",
      watchPath: "../etc/passwd",
    });
    expect(escape.status).toBe(400);

    const fromThread = await api("POST", "/api/routines/from-thread", {
      botId,
      name: "Daily Scan",
      prompt: "Scan repo for open issues",
      dailyAt: "08:00",
      onComplete: { targetBotId: botId, messageTemplate: "Scan finished" },
    });
    expect(fromThread.status).toBe(201);
    expect(fromThread.body.routine).toMatchObject({
      name: "Daily Scan",
      prompt: "Scan repo for open issues",
      dailyAt: "08:00",
      onComplete: { targetBotId: botId, messageTemplate: "Scan finished" },
    });
  });

  it("POST group 400s fake or hidden members; PATCH matches", async () => {
    const a = await api("POST", "/api/bots", { name: "VisA", title: "Ops" });
    const b = await api("POST", "/api/bots", { name: "HidB", title: "Ops" });
    await api("PATCH", `/api/bots/${b.body.bot.id}`, { hidden: true });

    const fake = await api("POST", "/api/bots", {
      kind: "group",
      name: "GhostGroup",
      memberIds: ["no-such-a", "no-such-b"],
    });
    expect(fake.status).toBe(400);

    const hidden = await api("POST", "/api/bots", {
      kind: "group",
      name: "HiddenMembers",
      memberIds: [a.body.bot.id, b.body.bot.id],
    });
    expect(hidden.status).toBe(400);

    const c = await api("POST", "/api/bots", { name: "VisC", title: "Ops" });
    const group = await api("POST", "/api/bots", {
      kind: "group",
      name: "OkRoom",
      memberIds: [a.body.bot.id, c.body.bot.id],
    });
    expect(group.status).toBe(201);

    const patched = await api("PATCH", `/api/bots/${group.body.bot.id}`, {
      memberIds: [a.body.bot.id, b.body.bot.id],
    });
    expect(patched.status).toBe(400);

    await api("DELETE", `/api/bots/${group.body.bot.id}`);
    await api("DELETE", `/api/bots/${a.body.bot.id}`);
    await api("DELETE", `/api/bots/${b.body.bot.id}`);
    await api("DELETE", `/api/bots/${c.body.bot.id}`);
  });

  it("jobs and steer skip hidden bots", async () => {
    const created = await api("POST", "/api/bots", { name: "HiddenJob", title: "Ops" });
    const id = created.body.bot.id;
    await api("PATCH", `/api/bots/${id}`, { hidden: true });

    const job = await api("POST", "/api/jobs", { botIds: [id], text: "hello hidden" });
    expect(job.status).toBe(202);
    expect(job.body.started).not.toContain(id);

    const tok = (await api("GET", "/api/steer")).body.token;
    const steer = await fetch(`${BASE}/api/steer/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ text: "hi", botIds: [id] }),
    });
    const steerBody = (await steer.json()) as { started?: string[] };
    expect(steer.status).toBe(202);
    expect(steerBody.started).not.toContain(id);

    await api("DELETE", `/api/bots/${id}`);
  });

  it("PUT memory 400s a huge profile and protects concurrent writes with CAS; attachment path is not copied into inbox", async () => {
    const created = await api("POST", "/api/bots", { name: "MemProbe", title: "Ops" });
    const id = created.body.bot.id;

    const huge = await api("PUT", `/api/bots/${id}/memory`, { profile: "x".repeat(20_000) });
    expect(huge.status).toBe(400);

    const mem = await api("GET", `/api/bots/${id}/memory`);
    expect(mem.status).toBe(200);
    expect(typeof mem.body.baseHash).toBe("string");

    const stalePut = await api("PUT", `/api/bots/${id}/memory`, {
      profile: "Stale write",
      baseHash: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(stalePut.status).toBe(409);
    expect(stalePut.body.error).toContain("CAS conflict");

    const ok = await api("PUT", `/api/bots/${id}/memory`, {
      profile: "Owner: Charles",
      baseHash: mem.body.baseHash,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.profile).toBe("Owner: Charles");
    expect(ok.body.baseHash).toBeDefined();

    const secret = join(home, "secret-keys.txt");
    writeFileSync(secret, "COMMS_TOKEN=leak");
    const send = await api("POST", `/api/bots/${id}/messages`, {
      text: "see attached",
      files: [{ name: "secret-keys.txt", path: secret }],
    });
    expect(send.status).toBe(409);
    expect(existsSync(join(home, ".nexbot", "desk", id, "inbox", "secret-keys.txt"))).toBe(false);

    const denied = await api("POST", `/api/bots/${id}/computer/exec`, {
      command: "cat /proc/self/environ",
    });
    expect(denied.status).toBe(400);

    await api("DELETE", `/api/bots/${id}`);
  });

  it("GET /api/search hits FTS5 transcript text", async () => {
    const found = await api("GET", "/api/search?q=" + encodeURIComponent("sleeps"));
    expect(found.status).toBe(200);
    expect(found.body.results.length).toBeGreaterThan(0);
    expect(found.body.results.some((h: { text?: string }) => /sleep/i.test(h.text ?? ""))).toBe(true);
    const empty = await api("GET", "/api/search?q=");
    expect(empty.status).toBe(400);
  });

  it("GET /api/feed returns aggregated action items and summary counts", async () => {
    const feed = await api("GET", "/api/feed");
    expect(feed.status).toBe(200);
    expect(feed.body.summary).toBeDefined();
    expect(typeof feed.body.summary.total).toBe("number");
    expect(Array.isArray(feed.body.items)).toBe(true);
  });

  it("POST /api/jobs/:id/retry and /resume return 404 for unknown jobs", async () => {
    const retry = await api("POST", "/api/jobs/nonexistent-id/retry");
    expect(retry.status).toBe(404);
    const resume = await api("POST", "/api/jobs/nonexistent-id/resume");
    expect(resume.status).toBe(404);
  });

  it("requires the wipe password and confirmation, then clears local bot data", async () => {
    const denied = await fetch(`${BASE}/api/wipe`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexbot-wipe-password": "wrong" },
      body: JSON.stringify({ confirmation: "WIPE" }),
    });
    expect(denied.status).toBe(401);

    const missingPhrase = await fetch(`${BASE}/api/wipe`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexbot-wipe-password": WIPE_PASSWORD },
      body: JSON.stringify({ confirmation: "no" }),
    });
    expect(missingPhrase.status).toBe(400);

    const wiped = await fetch(`${BASE}/api/wipe`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexbot-wipe-password": WIPE_PASSWORD },
      body: JSON.stringify({ confirmation: "WIPE" }),
    });
    expect(wiped.status).toBe(200);
    const wipeBody = (await wiped.json()) as { summary: { bots: number; messages: number } };
    expect(wipeBody.summary.bots).toBeGreaterThan(0);
    expect(wipeBody.summary.messages).toBeGreaterThan(0);

    const after = await api("GET", "/api/bots");
    expect(after.body.bots).toEqual([]);
    expect((await api("GET", "/api/routines")).body.routines).toEqual([]);
    expect((await api("GET", "/api/skills")).body.skills.some((s: { slug: string }) => s.slug === "file-invoices")).toBe(true);
  });
});
