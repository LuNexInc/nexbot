import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverCreateInput, SendTurnInput } from "../contracts.ts";
import { BoxAgentDriver } from "./boxagent.ts";

const boxFetch = vi.fn();

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function instance(pollMs = 5) {
  const input: DriverCreateInput<{ pollMs: number }> = {
    instanceId: "computer",
    displayName: "Computer",
    enabled: true,
    config: BoxAgentDriver.decodeConfig({ pollMs }),
    environment: { BOX_TOKEN: "test-token" },
  };
  return BoxAgentDriver.create(input);
}

function turn(boxId = "b1"): SendTurnInput {
  return {
    threadId: "t1",
    text: "do it",
    integrations: { computer: { boxId, token: "t" } },
  };
}

function mockBoxRun(events: unknown[], status: unknown) {
  boxFetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.endsWith("/boxes/b1/prompt")) return ok({ prompt: { id: "p1" } });
    if (u.includes("/events")) return ok({ events });
    if (u.includes("/prompts/")) return ok({ prompt: status });
    return ok({});
  });
}

function collect(inst: Awaited<ReturnType<typeof instance>>) {
  const events: Array<Record<string, unknown>> = [];
  inst.adapter.onEvent((e) => events.push(e as unknown as Record<string, unknown>));
  return events;
}

function authOf(opts: RequestInit | undefined): string {
  const headers = new Headers(opts?.headers);
  return headers.get("authorization") ?? "";
}

beforeEach(() => {
  boxFetch.mockReset();
  vi.stubGlobal("fetch", boxFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("box agent driver", () => {
  it("decodes config with a pollMs default", () => {
    expect(BoxAgentDriver.decodeConfig({})).toEqual({ pollMs: 2500 });
    expect(BoxAgentDriver.decodeConfig({ pollMs: 100 })).toEqual({ pollMs: 100 });
  });

  it("settles a completed box run and reports the assistant result", async () => {
    mockBoxRun([{ id: "e1", type: "assistant", text: "hello" }], { status: "completed", result: "final answer" });
    const inst = await instance();
    const events = collect(inst);
    await inst.adapter.sendTurn(turn());
    await vi.waitFor(() => expect(events.some((e) => e.type === "turn.completed")).toBe(true), { timeout: 3000 });
    const completed = events.filter((e) => e.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].ok).toBe(true);
    const text = events.filter((e) => e.type === "item.completed" && e.itemType === "assistant_text").map((e) => e.text);
    expect(text).toEqual(["final answer"]);
  });

  it("settles a failed box run as not ok", async () => {
    mockBoxRun([], { status: "failed" });
    const inst = await instance();
    const events = collect(inst);
    await inst.adapter.sendTurn(turn());
    await vi.waitFor(() => expect(events.some((e) => e.type === "turn.completed")).toBe(true), { timeout: 3000 });
    const completed = events.filter((e) => e.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].ok).toBe(false);
  });

  it("emits exactly one content.delta per unique assistant event id", async () => {
    mockBoxRun([{ id: "e1", type: "assistant", text: "hello" }], { status: "completed", result: "hello" });
    const inst = await instance();
    const events = collect(inst);
    await inst.adapter.sendTurn(turn());
    await vi.waitFor(() => expect(events.some((e) => e.type === "turn.completed")).toBe(true), { timeout: 3000 });
    const deltas = events.filter((e) => e.type === "content.delta").map((e) => e.delta);
    expect(deltas).toEqual(["hello"]);
  });

  it("authenticates prompt, events, and status with the per-bot computer token", async () => {
    const auths: string[] = [];
    boxFetch.mockImplementation(async (url, opts) => {
      const u = String(url);
      if (u.endsWith("/boxes/b1/prompt")) {
        auths.push("prompt:" + authOf(opts));
        return ok({ prompt: { id: "p1" } });
      }
      if (u.includes("/events")) {
        auths.push("events:" + authOf(opts));
        return ok({ events: [] });
      }
      if (u.includes("/prompts/")) {
        auths.push("status:" + authOf(opts));
        return ok({ prompt: { status: "completed", result: "ok" } });
      }
      return ok({});
    });
    const inst = await instance();
    const events = collect(inst);
    await inst.adapter.sendTurn(turn());
    await vi.waitFor(() => expect(events.some((e) => e.type === "turn.completed")).toBe(true), { timeout: 3000 });
    expect(auths.length).toBeGreaterThanOrEqual(3);
    expect(auths.every((a) => a.endsWith("Bearer t"))).toBe(true);
    expect(auths).not.toContain("Bearer test-token");
  });
});
