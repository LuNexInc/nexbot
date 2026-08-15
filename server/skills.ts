// Local SKILL.md files. agentskills.io minimum: name + description.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

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

type BuiltinSkillSpec = {
  slug: string;
  name: string;
  description: string;
  when: string;
  steps: string;
  validate: string;
  approval?: string;
};

/** Small role-focused skills that are always available, even before a user
 * creates or imports a local SKILL.md. */
const BUILTIN_SKILL_SPECS: readonly BuiltinSkillSpec[] = [
  {
    slug: "chief-of-staff-routing",
    name: "Route work",
    description: "Triage a request, choose the right NexBot, and keep the owner informed.",
    when: "A request spans more than one job or needs a clear owner.",
    steps: "Clarify the outcome, select one specialist, send the smallest useful handoff, then summarize the result.",
    validate: "The owner knows who owns the next action and what happens next.",
  },
  {
    slug: "decision-briefs",
    name: "Decision brief",
    description: "Turn scattered facts into a short decision, options, and recommendation.",
    when: "The owner needs to choose a path or approve a tradeoff.",
    steps: "State the decision, list material facts, compare options, recommend one, and name the risk.",
    validate: "The brief can be acted on without rereading the whole thread.",
  },
  {
    slug: "project-build-plan",
    name: "Build plan",
    description: "Break a named project into concrete milestones, files, and next steps.",
    when: "A project needs a concrete path from idea to working output.",
    steps: "Define the deliverable, inspect the current state, sequence small milestones, and identify the next test.",
    validate: "Each milestone has an observable result and a clear owner.",
  },
  {
    slug: "implementation-checklist",
    name: "Implementation checklist",
    description: "Keep implementation work focused, testable, and ready for handoff.",
    when: "Code, files, or configuration must be changed safely.",
    steps: "Check constraints, make the smallest change, run focused checks, and report residual risk.",
    validate: "The requested behavior works and the verification result is recorded.",
  },
  {
    slug: "idea-shaping",
    name: "Shape an idea",
    description: "Turn a rough idea into a clear concept with audience, purpose, and next move.",
    when: "A rough thought needs structure before work begins.",
    steps: "Restate the idea, identify the audience, define the useful outcome, and propose one next experiment.",
    validate: "The concept is specific enough to draft or test.",
  },
  {
    slug: "creative-brief",
    name: "Creative brief",
    description: "Create a concise brief for creative work, including intent, constraints, and references.",
    when: "A creative task needs direction before drafting.",
    steps: "Set the objective, audience, tone, required elements, exclusions, and delivery format.",
    validate: "Another person can start the work from the brief.",
  },
  {
    slug: "source-research",
    name: "Source research",
    description: "Find useful sources, check their quality, and keep claims tied to evidence.",
    when: "A question needs current or niche information.",
    steps: "Search authoritative sources, compare dates and claims, record links, and separate facts from inference.",
    validate: "Important claims have a source and uncertainty is visible.",
  },
  {
    slug: "source-briefing",
    name: "Source briefing",
    description: "Turn researched material into a concise, sourced briefing.",
    when: "The owner needs a decision-ready summary from multiple sources.",
    steps: "Group the evidence, remove repetition, state the conclusion, and attach sources to claims.",
    validate: "The reader can verify the conclusion without searching again.",
  },
  {
    slug: "message-drafting",
    name: "Message drafting",
    description: "Draft clear messages that match the audience, purpose, and requested tone.",
    when: "A message, email, or outreach note needs to be written.",
    steps: "Identify the recipient and ask, lead with the purpose, include only needed context, and end with one next action.",
    validate: "The recipient can understand and answer the message quickly.",
    approval: "Ask before sending.",
  },
  {
    slug: "follow-up",
    name: "Follow-up",
    description: "Track open loops and write short, useful follow-ups.",
    when: "A conversation or handoff has an unresolved next action.",
    steps: "Find the last commitment, state what is waiting, set a reasonable date, and keep the note brief.",
    validate: "The next action and owner are explicit.",
    approval: "Ask before sending.",
  },
  {
    slug: "process-ops",
    name: "Process operations",
    description: "Turn recurring work into a reliable sequence with checks and ownership.",
    when: "A recurring process is unclear, slow, or easy to forget.",
    steps: "Map the trigger, inputs, steps, exceptions, owner, and completion signal.",
    validate: "The process can run twice with the same expected result.",
  },
  {
    slug: "handoff-checklist",
    name: "Handoff checklist",
    description: "Make a handoff complete enough for another person or NexBot to continue.",
    when: "Work moves between people, bots, or sessions.",
    steps: "State the goal, current state, files or links, decisions, blocker, and exact next action.",
    validate: "The recipient can continue without asking for missing context.",
  },
  {
    slug: "creative-direction",
    name: "Creative direction",
    description: "Set visual direction with a clear hierarchy, constraints, and review criteria.",
    when: "Visual work needs a consistent direction or refinement pass.",
    steps: "Set the intent, hierarchy, palette, typography, interaction, and rejection criteria.",
    validate: "The direction can be reviewed against explicit criteria.",
  },
  {
    slug: "design-review",
    name: "Design review",
    description: "Review an interface for clarity, accessibility, hierarchy, and interaction quality.",
    when: "A screen or flow needs a practical design critique.",
    steps: "Check the primary action, spacing, states, keyboard path, contrast, and responsive behavior.",
    validate: "Findings are ordered by user impact and include a concrete fix.",
  },
];

export const BUILTIN_SKILLS: readonly SkillRecord[] = BUILTIN_SKILL_SPECS.map((skill) => ({
  slug: skill.slug,
  name: skill.name,
  description: skill.description,
  path: `builtin:${skill.slug}`,
  source: "nexbot",
  fields: {
    when: skill.when,
    inputs: "The user's request and the current NexBot workspace state.",
    steps: skill.steps,
    validate: skill.validate,
    output: "A concise result with the next action, if one remains.",
    approval: skill.approval ?? "Ask before external side effects or deletion.",
  },
  valid: true,
}));

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "skill";
}

export function parseSkillMarkdown(raw: string, path: string, source: SkillRecord["source"]): SkillRecord {
  let slug = basename(path, ".md");
  if (slug.toLowerCase() === "skill") slug = basename(dirname(path));
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
  const nexbotFiles: string[] = [];
  walkMd(SKILLS_DIR, nexbotFiles);
  for (const p of nexbotFiles) paths.push({ path: p, source: "nexbot" });
  const claude = join(homedir(), ".claude", "skills");
  const claudeFiles: string[] = [];
  walkMd(claude, claudeFiles);
  for (const p of claudeFiles) paths.push({ path: p, source: "claude" });

  const seen = new Set<string>(BUILTIN_SKILLS.map((skill) => skill.slug));
  const out: SkillRecord[] = [...BUILTIN_SKILLS];
  for (const row of paths) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    try {
      const skill = parseSkillMarkdown(readFileSync(row.path, "utf8"), row.path, row.source);
      if (seen.has(skill.slug)) continue;
      seen.add(skill.slug);
      out.push(skill);
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
  const dir = join(SKILLS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  const fields: SkillFields = { ...EMPTY_FIELDS, ...input.fields };
  writeFileSync(path, renderSkillMarkdown({ name, description, fields }));
  return parseSkillMarkdown(readFileSync(path, "utf8"), path, "nexbot");
}

export function deleteSkill(slug: string): boolean {
  const safe = slugify(slug);
  const flat = join(SKILLS_DIR, `${safe}.md`);
  const nested = join(SKILLS_DIR, safe, "SKILL.md");
  let gone = false;
  if (existsSync(flat)) {
    unlinkSync(flat);
    gone = true;
  }
  if (existsSync(nested)) {
    unlinkSync(nested);
    gone = true;
  }
  return gone;
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


/** Distill a SKILL.md under ~/.nexbot/skills/<slug>/ from a multi-tool success turn. */
export function distillSkillFromTurn(input: {
  name?: string;
  userText: string;
  assistantText: string;
  toolNames: string[];
}): SkillRecord | null {
  const tools = input.toolNames.filter((n) => n && !n.startsWith("error:"));
  if (tools.length < 2) return null;
  const draft = skillFromTurn({ ...input, toolNames: tools });
  const slug = slugify(draft.name);
  mkdirSync(join(SKILLS_DIR, slug), { recursive: true });
  const path = join(SKILLS_DIR, slug, "SKILL.md");
  if (!existsSync(path)) writeFileSync(path, renderSkillMarkdown(draft));
  return parseSkillMarkdown(readFileSync(path, "utf8"), path, "nexbot");
}

/** null/missing = every valid desk skill; string[] = only those slugs. */
export const autoDistillFromTurn = distillSkillFromTurn;

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
