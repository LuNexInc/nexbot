import { describe, expect, it } from "vitest";
import {
  mergeConsecutiveAssistant,
  preserveReasoningOnAssistant,
  reasoningContentFromDelta,
} from "./hermes.ts";

describe("mergeConsecutiveAssistant", () => {
  it("merges adjacent assistant messages (content + tool_calls + reasoning)", () => {
    const merged = mergeConsecutiveAssistant([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "step 1",
        reasoning_content: "think-a",
        tool_calls: [{ id: "c1", type: "function", function: { name: "todo", arguments: "{}" } }],
      },
      {
        role: "assistant",
        content: "step 2",
        reasoning_content: "think-b",
        tool_calls: [{ id: "c2", type: "function", function: { name: "todo", arguments: "{}" } }],
      },
      { role: "tool", content: "ok" },
      { role: "assistant", content: "done" },
    ]);
    expect(merged).toHaveLength(4);
    expect(merged[1].role).toBe("assistant");
    expect(merged[1].content).toBe("step 1step 2");
    expect(merged[1].reasoning_content).toBe("think-athink-b");
    expect(merged[1].tool_calls).toHaveLength(2);
    expect(merged[2].role).toBe("tool");
    expect(merged[3].content).toBe("done");
  });

  it("does not merge assistants split by a tool result", () => {
    const merged = mergeConsecutiveAssistant([
      { role: "assistant", content: "a", tool_calls: [{ id: "1" }] },
      { role: "tool", content: "r" },
      { role: "assistant", content: "b", tool_calls: [{ id: "2" }] },
    ]);
    expect(merged).toHaveLength(3);
  });
});

describe("reasoningContentFromDelta", () => {
  it("reads DeepSeek reasoning_content", () => {
    expect(reasoningContentFromDelta({ content: "hi", reasoning_content: "secret" })).toBe("secret");
  });
  it("reads Codex reasoning string and nested content", () => {
    expect(reasoningContentFromDelta({ reasoning: "codex-think" })).toBe("codex-think");
    expect(reasoningContentFromDelta({ reasoning: { content: "nested" } })).toBe("nested");
    expect(reasoningContentFromDelta({ reasoning: { text: "txt" } })).toBe("txt");
  });
  it("returns empty when absent", () => {
    expect(reasoningContentFromDelta({ content: "x" })).toBe("");
    expect(reasoningContentFromDelta(null)).toBe("");
  });
});

describe("preserveReasoningOnAssistant", () => {
  it("keeps reasoning_content on the assistant message", () => {
    const msg = preserveReasoningOnAssistant({ role: "assistant", content: "ok" }, "because");
    expect(msg.reasoning_content).toBe("because");
  });
  it("drops the field when there is nothing to echo", () => {
    const msg = preserveReasoningOnAssistant({ role: "assistant", content: "ok", reasoning_content: "" }, "");
    expect(msg.reasoning_content).toBeUndefined();
  });
});
