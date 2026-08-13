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
});
