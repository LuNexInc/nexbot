import { describe, expect, it } from "vitest";
import { isGutsActivity, isLowValueSystemMessage, isWorkingNarration, stripWorkingNarration, extractThinking } from "./activity";

describe("isLowValueSystemMessage", () => {
  it("hides control prompts and empty proactive updates", () => {
    expect(
      isLowValueSystemMessage({
        source: "proactive",
        text: "[Task-triggered check: todo-updated]\nAct on the task event now.",
      }),
    ).toBe(true);
    expect(isLowValueSystemMessage({ source: "proactive", text: "Inbox is empty. NO_UPDATE" })).toBe(true);
    expect(isLowValueSystemMessage({ source: "completion", text: "[Completion report]" })).toBe(true);
  });

  it("keeps useful proactive updates and user messages", () => {
    expect(isLowValueSystemMessage({ source: "proactive", text: "The form is live and has 12 responses." })).toBe(false);
    expect(isLowValueSystemMessage({ source: "user", text: "Please check the form." })).toBe(false);
  });
});

describe("isGutsActivity", () => {
  it("hides listed internal tool pills", () => {
    for (const name of [
      "list_dir",
      "read_file",
      "grep",
      "search_tool",
      "use_tool",
      "search_replace",
      "glob",
      "List Dir",
      "read-file",
    ]) {
      expect(isGutsActivity({ kind: "activity", tool: { name } }), name).toBe(true);
    }
  });

  it("hides ask_bot, git, and shell dispatcher pills", () => {
    expect(
      isGutsActivity({ kind: "activity", tool: { name: "asked @Research: say hi" } }),
    ).toBe(true);
    expect(isGutsActivity({ kind: "activity", tool: { name: "@Luna → @Research" } })).toBe(true);
    expect(
      isGutsActivity({
        kind: "activity",
        tool: { name: 'git add -- "handoff/note.md"' },
      }),
    ).toBe(true);
    expect(
      isGutsActivity({ kind: "activity", tool: { name: 'Get-Date -Format "yyyy-MM-dd"' } }),
    ).toBe(true);
  });

  it("keeps error activity and non-activity messages", () => {
    expect(
      isGutsActivity({ kind: "activity", tool: { name: "error: provider unavailable" } }),
    ).toBe(false);
    expect(isGutsActivity({ kind: "text", tool: { name: "list_dir" } })).toBe(false);
    expect(isGutsActivity({ kind: "text" })).toBe(false);
  });
});

describe("stripWorkingNarration", () => {
  it("hides a bubble that is only I'll-pull / updating-the-note", () => {
    expect(isWorkingNarration("I'll pull the current workspace state.")).toBe(true);
    expect(stripWorkingNarration("I'll pull the current workspace state.")).toBe("");
    expect(stripWorkingNarration("Updating the day log and writing a short handoff.")).toBe("");
    expect(stripWorkingNarration("Checking the desk.")).toBe("");
    expect(stripWorkingNarration("Let me see.")).toBe("");
  });

  it("hides I'll-confirm / day-note / I'll-give-you working-narration", () => {
    expect(stripWorkingNarration("I'll confirm nothing newer landed.")).toBe("");
    expect(stripWorkingNarration("Updating the day note.")).toBe("");
    expect(stripWorkingNarration("I'll give you the short version.")).toBe("");
    expect(stripWorkingNarration("I'll give you the two items.")).toBe("");
    expect(
      stripWorkingNarration(
        "Two open items from today - I'll confirm nothing newer landed…Updating the day note, then I'll give you the two items…",
      ),
    ).toBe("");
  });

  it("keeps a real answer and strips leading preamble", () => {
    expect(
      stripWorkingNarration(
        "I'll pull the current workspace state first so I can give you a real status, not a recap.Updating the day log and writing a short handoff so this status ping is on the record.Quiet night. Two things on the board.",
      ),
    ).toBe("Quiet night. Two things on the board.");
    expect(stripWorkingNarration("Quiet night. Two things on the board.")).toBe(
      "Quiet night. Two things on the board.",
    );
    expect(isWorkingNarration("Hey. Nothing's on fire.")).toBe(false);
    expect(
      stripWorkingNarration(
        "I'll give you the short version. Two things: Bloominary still needs a look and Basiliskos is the other item.",
      ),
    ).toBe("Two things: Bloominary still needs a look and Basiliskos is the other item.");
    expect(
      stripWorkingNarration("Two things: Bloominary… Basiliskos still needs a human check."),
    ).toBe("Two things: Bloominary… Basiliskos still needs a human check.");
  });

  it("removes a live work preamble while keeping the useful status", () => {
    expect(
      stripWorkingNarration(
        "I'll sync Luna's notes and the hey skill so the first line is the real status. Following the hey skill: desk, latest notes, clock, then a short status. Basiliskos 2.5.1 is already on the machine.",
      ),
    ).toBe("Basiliskos 2.5.1 is already on the machine.");
  });
});

describe("extractThinking", () => {
  it("extracts closed <think> tag and separates clean answer", () => {
    const text = "<think>\nLet me analyze the user request.\nStep 1: Check memory.\n</think>\nHere is the answer to your question.";
    const res = extractThinking(text);
    expect(res.thinking).toBe("Let me analyze the user request.\nStep 1: Check memory.");
    expect(res.cleanText).toBe("Here is the answer to your question.");
  });

  it("handles alternative tags <thought> and <reasoning>", () => {
    const res1 = extractThinking("<thought>Thinking deeply...</thought>Final result.");
    expect(res1.thinking).toBe("Thinking deeply...");
    expect(res1.cleanText).toBe("Final result.");

    const res2 = extractThinking("<reasoning>Deducing facts...</reasoning>Done.");
    expect(res2.thinking).toBe("Deducing facts...");
    expect(res2.cleanText).toBe("Done.");
  });

  it("returns null thinking when no think tags are present", () => {
    const res = extractThinking("Plain message without thinking tags.");
    expect(res.thinking).toBeNull();
    expect(res.cleanText).toBe("Plain message without thinking tags.");
  });

  it("handles unclosed <think> tag during streaming", () => {
    const res = extractThinking("<think>Still generating chain of thought...");
    expect(res.thinking).toBe("Still generating chain of thought...");
    expect(res.cleanText).toBe("");
  });
});
