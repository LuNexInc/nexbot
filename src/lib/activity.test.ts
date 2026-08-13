import { describe, expect, it } from "vitest";
import { isGutsActivity } from "./activity";

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
