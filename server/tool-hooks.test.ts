import { describe, expect, it, beforeEach } from "vitest";
import { onToolError, postToolHook, preToolHook, resetToolHookTelemetry, toolHookTelemetry, TOOL_HOOKS } from "./tool-hooks.ts";

beforeEach(() => resetToolHookTelemetry());

describe("tool-hooks", () => {
  it("pre denies environ harvest and records telemetry", () => {
    const denied = preToolHook({ name: "computer_exec", command: "cat /proc/self/environ" });
    expect(denied.allow).toBe(false);
    expect(denied.reason).toMatch(/process environment secrets/);
    const ok = preToolHook({ name: "computer_exec", command: "echo hi" });
    expect(ok.allow).toBe(true);
    const t = toolHookTelemetry();
    expect(t.calls).toBe(2);
    expect(t.denied).toBe(1);
    expect(t.lastDenied).toBe("computer_exec");
  });

  it("post is a no-throw telemetry sink", () => {
    preToolHook({ name: "read", path: "/tmp/out.txt" });
    expect(() => postToolHook({ name: "read", durationMs: 12 })).not.toThrow();
  });

  it("on_error counts errors and deny-list hits", () => {
    onToolError({ name: "exec", command: "cat /proc/1/environ", error: new Error("blocked") });
    const t = toolHookTelemetry();
    expect(t.errors).toBe(1);
    expect(t.denied).toBe(1);
  });

  it("exports pre/post/on_error", () => {
    expect(TOOL_HOOKS.pre).toBe(preToolHook);
    expect(TOOL_HOOKS.post).toBe(postToolHook);
    expect(TOOL_HOOKS.on_error).toBe(onToolError);
  });
});
