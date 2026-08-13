// Local SKILL.md files. agentskills.io minimum: name + description.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { DATA_DIR } from "./config.ts";

export const SKILLS_DIR = join(DATA_DIR, "skills");

export type SkillFields = {
  when: string;
  inputs: string;
  steps: string;
  validate: string;
  output: string;
  approval: string;
};

export type SkillRecord = {
  slug: string;
  name: string;
  description: string;
  path: string;
  source: "nexbot" | "claude";
  fields: SkillFields;
  valid: boolean;
  error?: string;
};

const EMPTY_FIELDS: SkillFields = {
  when: "",
  inputs: "",
  steps: "",
  validate: "",
  output: "",
  approval: "",
};

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "skill";
}

export function parseSkillMarkdown(raw: string, path: string, source: SkillRecord["source"]): SkillRecord {
  const slug = basename(path, ".md");
  let name = slug;
  let description = "";
  let body = raw;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "name") name = val || name;
      if (key === "description") description = val;
    }
  }
  const fields = { ...EMPTY_FIELDS };
  const heading = (label: string) =>
    new RegExp(`^#+\\s*${label}\\s*$`, "im");
  const section = (label: keyof SkillFields, aliases: string[]) => {
    for (const a of aliases) {
      const re = heading(a);
      const m = body.match(re);
      if (!m || m.index === undefined) continue;
      const start = m.index + m[0].length;
      const rest = body.slice(start);
      const next = rest.search(/^#+\s+/m);
      fields[label] = (next === -1 ? rest : rest.slice(0, next)).trim();
      return;
    }
  };
  section("when", ["When", "Trigger"]);
  section("inputs", ["Inputs", "Input"]);
  section("steps", ["Steps", "Process"]);
  section("validate", ["Validate", "Validation"]);
  section("output", ["Output", "Result"]);
  section("approval", ["Approval", "Approve"]);
  const valid = Boolean(name.trim() && description.trim());
  return {
    slug,
    name: name.trim(),
    description: description.trim(),
    path,
    source,
    fields,
    valid,
    error: valid ? undefined : "SKILL.md needs name and description",
  };
}

export function renderSkillMarkdown(skill: { name: string; description: string; fields: SkillFields }): string {
  const f = skill.fields;
  return `---
name: ${skill.name}
description: ${skill.description}
---

# When
${f.when}

# Inputs
${f.inputs}

# Steps
${f.steps}

# Validate
${f.validate}

# Output
${f.output}

# Approval
${f.approval}
`;
}

function walkMd(dir: string, out: string[], depth = 0) {
  if (depth > 3 || !existsSync(dir)) return;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMd(p, out, depth + 1);
    else if (name.toLowerCase() === "skill.md" || (name.toLowerCase().endsWith(".md") && dir.endsWith("skills"))) {
      out.push(p);
    }
  }
}

export function listSkills(): SkillRecord[] {
  const paths: Array<{ path: string; source: SkillRecord["source"] }> = [];
  mkdirSync(SKILLS_DIR, { recursive: true });
  walkMd(SKILLS_DIR, [] as string[]);
  try {
    for (const name of readdirSync(SKILLS_DIR)) {
      if (name.toLowerCase().endsWith(".md")) paths.push({ path: join(SKILLS_DIR, name), source: "nexbot" });
    }
  } catch {
    /* empty */
  }
  const claude = join(homedir(), ".claude", "skills");
  const claudeFiles: string[] = [];
  walkMd(claude, claudeFiles);
  for (const p of claudeFiles) paths.push({ path: p, source: "claude" });

  const seen = new Set<string>();
  const out: SkillRecord[] = [];
  for (const row of paths) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    try {
      out.push(parseSkillMarkdown(readFileSync(row.path, "utf8"), row.path, row.source));
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export function saveSkill(input: { name: string; description: string; fields?: Partial<SkillFields>; slug?: string }): SkillRecord {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || !description) throw Object.assign(new Error("name and description required"), { status: 400 });
  const slug = slugify(input.slug || name);
  mkdirSync(SKILLS_DIR, { recursive: true });
  const path = join(SKILLS_DIR, `${slug}.md`);
  const fields: SkillFields = { ...EMPTY_FIELDS, ...input.fields };
  writeFileSync(path, renderSkillMarkdown({ name, description, fields }));
  return parseSkillMarkdown(readFileSync(path, "utf8"), path, "nexbot");
}

export function deleteSkill(slug: string): boolean {
  const path = join(SKILLS_DIR, `${slugify(slug)}.md`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function skillFromTurn(input: {
  name?: string;
  userText: string;
  assistantText: string;
  toolNames: string[];
}): { name: string; description: string; fields: SkillFields } {
  const user = input.userText.trim().slice(0, 2000);
  const assistant = input.assistantText.trim().slice(0, 4000);
  const tools = input.toolNames.filter(Boolean);
  const name = (input.name || user.split(/\n/)[0] || "saved turn").slice(0, 80);
  return {
    name,
    description: `Replay the turn that started with: ${user.slice(0, 160)}`,
    fields: {
      when: "After the owner asks for this same job again, or when a routine fires this skill.",
      inputs: user || "(no user text saved)",
      steps: tools.length
        ? tools.map((t, i) => `${i + 1}. ${t}`).join("\n")
        : assistant || "(no steps recorded)",
      validate: "The owner sees a finished result in the desk out/ folder or in chat.",
      output: assistant || "(no assistant text)",
      approval: "Ask before sending mail, spending money, or deleting files.",
    },
  };
}

/** null/missing = every valid desk skill; string[] = only those slugs. */
export function skillsForBot(enabledSlugs?: string[] | null): SkillRecord[] {
  const all = listSkills().filter((s) => s.valid);
  if (enabledSlugs == null) return all;
  const want = new Set(enabledSlugs);
  return all.filter((s) => want.has(s.slug));
}

export function skillsPrompt(enabledSlugs?: string[] | null): string {
  const skills = skillsForBot(enabledSlugs);
  if (!skills.length) return "";
  const lines = skills.map((s) => `- ${s.name} (${s.slug}): ${s.description} [${s.path}]`);
  return ` Skills available for this bot (follow when they fit):\n${lines.join("\n")}`;
}
