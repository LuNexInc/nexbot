import { describe, expect, it } from "vitest";

import { createWatchdog, isComputerToolName } from "./watchdog.ts";

describe("watchdog", () => {
  it("marks a turn stuck after stuckMs with no events", () => {
    const w = createWatchdog({ stuckMs: 50 });
    w.start("a");
    expect(w.stuckBots(Date.now() + 10)).toHaveLength(0);
    const stuck = w.stuckBots(Date.now() + 80);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].botId).toBe("a");
    expect(stuck[0].stuck).toBe(true);
  });

  it("poke clears stuck and records tokens and computer tools", () => {
    const w = createWatchdog({ stuckMs: 50 });
    w.start("a");
    w.poke("a", "item.started", { computerTool: true, tokens: { input: 12, output: 3 } });
    expect(w.get("a")?.computerTools).toBe(true);
    expect(w.get("a")?.tokens).toEqual({ input: 12, output: 3 });
    expect(w.stuckBots(Date.now() + 10)).toHaveLength(0);
    const ended = w.end("a");
    expect(ended?.events).toBe(1);
    expect(w.get("a")).toBeNull();
  });

  it("detects computer tool names", () => {
    expect(isComputerToolName("mcp__computer__click")).toBe(true);
    expect(isComputerToolName("screenshot")).toBe(true);
    expect(isComputerToolName("ask_bot")).toBe(false);
  });

  it("records ttfrMs from sendTimeMs to first content.delta", () => {
    const w = createWatchdog({ stallMs: 45_000 });
    w.start("a");
    const send = w.get("a")!.sendTimeMs;
    expect(w.poke("a", "item.started")).toBeUndefined();
    expect(w.get("a")?.ttfrMs).toBeUndefined();
    const ttfr = w.poke("a", "content.delta", { isChunk: true });
    expect(ttfr).toBeTypeOf("number");
    expect(w.get("a")?.firstTokenTimeMs).toBeGreaterThanOrEqual(send);
    expect(w.get("a")?.ttfrMs).toBe(ttfr);
    expect(w.poke("a", "content.delta", { isChunk: true })).toBeUndefined();
  });

  it("warns once when no token arrives within stallMs", () => {
    const w = createWatchdog({ stallMs: 40 });
    w.start("a");
    const t0 = w.get("a")!.sendTimeMs;
    expect(w.stalledBots(40, t0 + 10)).toHaveLength(0);
    const stalled = w.stalledBots(40, t0 + 50);
    expect(stalled).toHaveLength(1);
    expect(stalled[0].stalled).toBe(true);
    expect(w.stalledBots(40, t0 + 80)).toHaveLength(0);
  });

  it("checks budget ceiling and identifies runaway turns", () => {
    const w = createWatchdog();
    w.start("a");
    expect(w.isBudgetExceeded("a", 10_000)).toBe(false);
    w.poke("a", "usage", { tokens: { input: 8_000, output: 3_000 } });
    expect(w.isBudgetExceeded("a", 10_000)).toBe(true);
    expect(w.isBudgetExceeded("a", 20_000)).toBe(false);
  });
});
