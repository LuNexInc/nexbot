import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { fakeCliShim } from "../testing/fake-cli-shim.ts";
import { AntigravityDriver, buildAntigravityArgs } from "./antigravity.ts";

const FAKE_CLI_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-antigravity-cli.ts");

describe("AntigravityDriver decodeConfig", () => {
  it("uses the agy binary and enables headless permission handling by default", () => {
    const config = AntigravityDriver.decodeConfig({});
    expect(config.fullAuto).toBe(true);
    expect(config.cli.toLowerCase()).toMatch(/(?:agy(?:\.exe)?|agy[\\/])$/);
  });

  it("allows an explicit CLI and disables full auto only when false", () => {
    expect(AntigravityDriver.decodeConfig({ cli: "agy-test", fullAuto: false })).toEqual({ cli: "agy-test", fullAuto: false });
    expect(AntigravityDriver.decodeConfig({ fullAuto: "no" }).fullAuto).toBe(true);
  });
});

describe("AntigravityDriver stream-json turns", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;
  let fakeCli: string;

  const create = async (mode?: string) => {
    if (mode) process.env.FAKE_ANTIGRAVITY_MODE = mode;
    instance = await AntigravityDriver.create({
      instanceId: "antigravity-test",
      displayName: "Antigravity Test",
      environment: {},
      enabled: true,
      config: { cli: fakeCli, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    scratch = mkdtempSync(join(tmpdir(), "nexbot-antigravity-test-"));
    fakeCli = fakeCliShim(FAKE_CLI_SCRIPT, scratch, "fake-antigravity");
  });

  afterEach(async () => {
    delete process.env.FAKE_ANTIGRAVITY_MODE;
    delete process.env.FAKE_ANTIGRAVITY_DUMP;
    recorder?.stop();
    await instance?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("normalizes init, streamed text, tool steps, usage, and result", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-happy",
      text: "hi",
      model: "gemini-3.7-flash-low",
      reasoningEffort: "high",
    });
    await recorder.until((event) => event.type === "turn.completed");

    expect(recorder.events.map((event) => event.type)).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.started",
      "item.completed",
      "thread.token-usage.updated",
      "item.updated",
      "item.completed",
      "turn.completed",
    ]);
    expect(recorder.events.every((event) => event.turnId === turnId && event.provider === "antigravity")).toBe(true);
    expect(recorder.events.find((event) => event.type === "session.started")).toMatchObject({
      sessionId: "fake-antigravity-session",
      model: "gemini-3.7-flash-low",
    });
    expect(recorder.events.find((event) => event.type === "item.started")).toMatchObject({ title: "run_command" });
    expect(recorder.events.filter((event) => event.type === "thread.token-usage.updated").at(-1)).toMatchObject({ input: 10, output: 5 });
    expect(recorder.events.find((event) => event.type === "item.completed" && (event as any).itemType === "assistant_text")).toMatchObject({
      text: "hello from fake antigravity",
    });
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
  });

  it("builds agy's print-mode argv and resumes with --conversation", () => {
    const args = buildAntigravityArgs({
      threadId: "t-argv",
      text: "private prompt",
      system: "You are a test bot.",
      model: "gemini-3.7-flash-low",
      reasoningEffort: "medium",
      resumeCursor: "conversation-123",
    }, true);
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("You are a test bot.\n\nprivate prompt");
    for (const flag of [
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      "gemini-3.7-flash-low",
      "--effort",
      "medium",
      "--conversation",
      "conversation-123",
      "--dangerously-skip-permissions",
    ]) {
      expect(args).toContain(flag);
    }
  });

  it("normalizes max reasoning effort and -max model suffix to high for agy", () => {
    const args = buildAntigravityArgs({
      threadId: "t-max",
      text: "deep thinking prompt",
      model: "gemini-3.7-flash-max",
      reasoningEffort: "max",
    }, false);
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-3.7-flash-high");
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
  });

  it("turns an early CLI exit into a failed turn", async () => {
    await create("exit-early");
    await instance.adapter.sendTurn({ threadId: "t-crash", text: "go" });
    const done = await recorder.until((event) => event.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "exit_before_result" });
    expect(recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
  });

  it("reports a missing binary as unavailable", async () => {
    instance = await AntigravityDriver.create({
      instanceId: "antigravity-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: join(scratch, "missing-agy"), fullAuto: true },
    });
    expect(await instance.snapshot()).toMatchObject({ state: "unavailable" });
  });
});
