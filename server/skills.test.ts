import { rmSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";

import { DATA_DIR } from "./config.ts";
import { deleteSkill, listSkills, parseSkillMarkdown, saveSkill, skillFromTurn, skillsPrompt, slugify } from "./skills.ts";

describe("skills", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("rejects a file without name and description", () => {
    const rec = parseSkillMarkdown("# Steps\nDo a thing\n", "/tmp/x.md", "nexbot");
    expect(rec.valid).toBe(false);
  });

  it("round-trips a valid skill", () => {
    const saved = saveSkill({
      name: "Monday report",
      description: "Build the weekly scoreboard",
      fields: { when: "Monday 8am", inputs: "CRM", steps: "1. Export", validate: "Numbers match", output: "md file", approval: "Ask before send" },
    });
    expect(saved.valid).toBe(true);
    expect(saved.slug).toBe("monday-report");
    const listed = listSkills();
    expect(listed.some((s) => s.slug === "monday-report")).toBe(true);
    expect(deleteSkill("monday-report")).toBe(true);
    expect(deleteSkill("monday-report")).toBe(false);
  });

  it("builds six fields from a turn", () => {
    const draft = skillFromTurn({
      userText: "File the invoices",
      assistantText: "Filed three PDFs in out/",
      toolNames: ["read", "mcp__computer__click"],
    });
    expect(draft.fields.when).toContain("routine");
    expect(draft.fields.inputs).toContain("invoices");
    expect(draft.fields.steps).toContain("mcp__computer__click");
    expect(draft.fields.approval).toContain("Ask");
    expect(slugify(draft.name)).toBe("file-the-invoices");
  });

  it("skillsPrompt lists all when slugs are null and filters when listed", () => {
    saveSkill({ name: "Alpha", description: "A thing" });
    saveSkill({ name: "Beta", description: "B thing" });
    const all = skillsPrompt(null);
    expect(all).toContain("Alpha");
    expect(all).toContain("Beta");
    const only = skillsPrompt(["alpha"]);
    expect(only).toContain("Alpha");
    expect(only).not.toContain("Beta");
    expect(skillsPrompt([])).toBe("");
  });
});
