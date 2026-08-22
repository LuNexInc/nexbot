import { describe, expect, it } from "vitest";
import { isMeaningfulUpdate, proactivePrompt, shouldTriggerProactive } from "./proactivity.ts";

describe("task-triggered proactivity", () => {
  it("allows task events to wake enabled agents without a clock", () => {
    expect(shouldTriggerProactive({ name: "Luna", proactiveEnabled: true })).toBe(true);
    expect(shouldTriggerProactive({ name: "Research", proactiveEnabled: false })).toBe(false);
    expect(shouldTriggerProactive({ name: "Team", kind: "group" })).toBe(false);
  });

  it("builds a prompt from the task event and optional context", () => {
    const prompt = proactivePrompt("task-completed", "Research returned a brief.");
    expect(prompt).toContain("task-completed");
    expect(prompt).toContain("Research returned a brief.");
    expect(prompt).toContain("NO_UPDATE");
  });

  it("ignores empty proactive updates", () => {
    expect(isMeaningfulUpdate("NO_UPDATE")).toBe(false);
    expect(isMeaningfulUpdate("A concrete blocker")).toBe(true);
  });
});
