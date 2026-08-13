import { describe, expect, it } from "vitest";
import { isGutsActivity, isWorkingNarration, stripWorkingNarration } from "./activity";

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
  });
});
