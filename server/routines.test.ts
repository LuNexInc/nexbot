import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { createRoutine, deleteRoutinesForBot, dueRoutines, listRoutines, markRan, nextRunAfter, parseDailyAt, routineCreateError, watchPathEscapes } from "./routines.ts";

describe("routines", () => {
  afterEach(() => {
    try {
      unlinkSync(join(DATA_DIR, "routines.json"));
    } catch {}
  });

  it("everyMinutes schedules from now", () => {
    const from = Date.parse("2026-08-13T10:00:00Z");
    expect(nextRunAfter({ botId: "b", name: "n", prompt: "p", enabled: true, everyMinutes: 15 }, from)).toBe(
      from + 15 * 60_000,
    );
  });

  it("dueRoutines then markRan advances nextRunAt", () => {
    const r = createRoutine({
      botId: "b1",
      name: "Check mail",
      prompt: "check mail",
      everyMinutes: 15,
      enabled: true,
    });
    const due = dueRoutines(Date.now() + 16 * 60_000);
    expect(due.map((x) => x.id)).toContain(r.id);
    const after = markRan(r.id, Date.now() + 16 * 60_000);
    expect(after?.lastRunAt).toBeTruthy();
    expect(after!.nextRunAt!).toBeGreaterThan(after!.lastRunAt!);
  });

  it("cron still due; webhook and file are not in dueRoutines", () => {
    const cron = createRoutine({
      botId: "b1",
      name: "cron",
      prompt: "p",
      kind: "cron",
      everyMinutes: 1,
      enabled: true,
    });
    const hook = createRoutine({
      botId: "b1",
      name: "hook",
      prompt: "p",
      kind: "webhook",
      webhookSecret: "s3cret",
      githubRepo: "LuNexInc/nexbot",
      enabled: true,
    });
    const file = createRoutine({
      botId: "b1",
      name: "file",
      prompt: "p",
      kind: "file",
      watchPath: "/tmp/watched",
      enabled: true,
    });
    const due = dueRoutines(Date.now() + 120_000);
    expect(due.map((x) => x.id)).toEqual([cron.id]);
    expect(hook.nextRunAt).toBeUndefined();
    expect(file.nextRunAt).toBeUndefined();
  });

  it("persists webhook and file fields", () => {
    createRoutine({
      botId: "b1",
      name: "gh",
      prompt: "on push",
      kind: "webhook",
      webhookSecret: "tok",
      githubRepo: "Acme/App",
      enabled: true,
    });
    createRoutine({
      botId: "b1",
      name: "watch",
      prompt: "on change",
      kind: "file",
      watchPath: "C:\\Users\\Charles\\inbox",
      enabled: true,
    });
    const rows = listRoutines("b1");
    expect(rows.find((r) => r.name === "gh")).toMatchObject({
      kind: "webhook",
      webhookSecret: "tok",
      githubRepo: "Acme/App",
    });
    expect(rows.find((r) => r.name === "watch")).toMatchObject({
      kind: "file",
      watchPath: "C:\\Users\\Charles\\inbox",
    });
  });
});

describe("routineCreateError", () => {
  it("400-shape: file/file-watch need a non-empty watchPath", () => {
    expect(routineCreateError({ kind: "file" })).toBe("watchPath required");
    expect(routineCreateError({ kind: "file", watchPath: "" })).toBe("watchPath required");
    expect(routineCreateError({ kind: "file-watch" })).toBe("watchPath required");
    expect(routineCreateError({ kind: "file", watchPath: "/tmp/watched" })).toBeNull();
  });
  it("400-shape: dailyAt must be a real HH:MM, not clamped", () => {
    expect(parseDailyAt("not-a-time")).toBeNull();
    expect(parseDailyAt("25:99")).toBeNull();
    expect(parseDailyAt("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(routineCreateError({ dailyAt: "not-a-time" })).toBe("dailyAt must be HH:MM");
    expect(routineCreateError({ dailyAt: "25:99" })).toBe("dailyAt must be HH:MM");
    expect(routineCreateError({ dailyAt: "09:00" })).toBeNull();
  });
  it("400-shape: webhook needs a non-empty secret", () => {
    expect(routineCreateError({ kind: "webhook" })).toBe("webhookSecret required");
    expect(routineCreateError({ kind: "webhook", webhookSecret: "" })).toBe("webhookSecret required");
    expect(routineCreateError({ kind: "webhook", webhookSecret: "s3cret" })).toBeNull();
  });
  it("400-shape: watchPath must not contain ..", () => {
    expect(watchPathEscapes("../etc")).toBe(true);
    expect(watchPathEscapes("inbox/../../secrets")).toBe(true);
    expect(watchPathEscapes("C:\\Users\\Charles\\inbox")).toBe(false);
    expect(watchPathEscapes("/tmp/watched")).toBe(false);
    expect(routineCreateError({ kind: "file", watchPath: "../etc/passwd" })).toBe("watchPath must not contain ..");
    expect(routineCreateError({ kind: "file", watchPath: "/tmp/watched" })).toBeNull();
  });
});

describe("deleteRoutinesForBot", () => {
  it("removes every routine for that bot and leaves others", () => {
    createRoutine({ botId: "gone", name: "a", prompt: "p", enabled: true, everyMinutes: 15 });
    createRoutine({ botId: "stay", name: "b", prompt: "p", enabled: true, everyMinutes: 15 });
    expect(deleteRoutinesForBot("gone")).toBe(1);
    expect(listRoutines("gone")).toEqual([]);
    expect(listRoutines("stay")).toHaveLength(1);
    expect(deleteRoutinesForBot("gone")).toBe(0);
  });
});
