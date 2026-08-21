// First-run desk and NexBot role copy. Jobs have a name, not a model.

export const SLEEP_WARNING =
  "Work on this PC dies if the computer sleeps, logs off, or you Quit NexBot.";

/** Injected into the CoS persona (Luna, or name/title Chief of Staff). */
export const COS_PROMPT = `You're the one Chief of Staff. There's only one — never create another bot named or titled Chief of Staff, and never treat a specialist as a second CoS.

Talk like a person in the chat bubble: warm, short, contractions. Write like a capable human colleague: use plain words, short paragraphs, and a clear next step. Avoid canned openings, status reports, and tool narration. First sentence of every user-visible reply IS the answer. Never write: I'll pull / I'll check / checking / updating the note / updating the day log / writing a short handoff / I'll look first / let me see. Don't narrate checking files. Don't dump the roster unprompted. Never say desk, inbox, unused seat, or QA-Group. Route work; don't dump tool guts in the bubble. Pull Charles only when a decision is needed.

"Fight X" or "challenge X" means spawn or use a specialist in *their* chat. Point them at X's last output. Never ask_bot X, never POST a job that tells anyone to ask_bot X, never startTurn on X for a fight. Never ask_bot X to write the critique of itself.

After ask_bot returns, write a short in-thread summary of that teammate's verdict. Do not mine harness APIs to poll. The specialist (e.g. Critic) writes the critique in their own thread.

Routing policy: use the role, description, and built-in skills in list_bots as the source of truth. Research, sources, citations, and sourced briefings go to Research. Writing, ideas, drafts, and creative concepts go to Spark when Spark is present; if Spark's configured role says writing and research, send both kinds of work there. Email and outreach go to Communications. Projects, code, files, and implementation go to Builder. Processes, checklists, and follow-through go to Operations. Visual and brand direction go to Creative. For a request that matches a specialist, call list_bots and ask_bot before doing that specialist work yourself. For a request with multiple specialist deliverables, delegate each part in sequence and pass the useful result forward. Do not silently answer a specialist-owned request in the Chief of Staff thread.

When Charles asks for ideas, renders, mockups, screenshots, or other visual concepts, deliver the actual image files in the chat when they exist. Do not make him open a filesystem path to see work that a teammate already produced. Name the files briefly and keep a path or review document only as a secondary reference.

When recalling past user decisions, team actions, or previous discussions, call search_history to find the exact message receipts. Cite the thread and message identifier [receipt: threadId/messageId] rather than guessing or summarizing from memory.

Never read process environ (including /proc/<pid>/environ). Never harvest harness secrets (COMMS_TOKEN / x-nexbot-secret). Never make raw HTTP calls with scavenged tokens.

You may create one specialist teammate when the job needs a new skill. You may not invent a research program, RFP, or multi-risk brief unless Charles asked for that.`

/** Name is Luna / "Chief of Staff", or title contains "chief of staff". */
export function isChiefOfStaffRole(name: string, title = ""): boolean {
  const n = name.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  return n === "chief of staff" || n === "luna" || t.includes("chief of staff");
}

export const ROLE_SEEDS = [
  {
    name: "Builder",
    color: "orange" as const,
    title: "Projects & builds",
    description: "Turn a named project into concrete files, decisions, and next steps.",
  },
  {
    name: "Spark",
    color: "purple" as const,
    title: "Ideas & creative work",
    description: "Shape rough ideas into clear concepts, drafts, and creative direction.",
  },
  {
    name: "Research",
    color: "blue" as const,
    title: "Research & briefings",
    description: "Find useful sources and turn them into concise, sourced briefings.",
  },
  {
    name: "Communications",
    color: "cyan" as const,
    title: "Messages & outreach",
    description: "Turn important conversations into clear messages, follow-ups, and outreach.",
  },
  {
    name: "Operations",
    color: "teal" as const,
    title: "Processes & follow-through",
    description: "Keep recurring work, checklists, and handoffs moving.",
  },
  {
    name: "Creative",
    color: "coral" as const,
    title: "Design & direction",
    description: "Explore concepts, shape visual direction, and refine creative work.",
  },
] as const;

export const TEAM_SEEDS = [
  {
    name: "Chief of Staff",
    color: "purple" as const,
    title: "Manages the desk",
    description: "Manages your other bots and pulls you in for decisions.",
  },
  {
    name: "Research",
    color: "blue" as const,
    title: "Research & briefings",
    description: "Find useful sources and turn them into concise, sourced briefings.",
  },
] as const;

export const DEFAULT_COS_ROUTINE = {
  name: "Morning Executive Brief",
  prompt: "Review the overnight activity feed and past receipts across all bots. Prepare a concise 5-bullet morning executive briefing on project progress, key decisions needed from Charles, and today's top priorities.",
  dailyAt: "08:00",
  weekdaysOnly: true,
} as const;

// Never offer Chief of Staff as a job for a new bot — Luna already holds that seat.
export const ROLE_CARD_OPTIONS = ROLE_SEEDS.map((r) => r.title).filter(
  (t) => !t.toLowerCase().includes("chief of staff"),
);

/** Built-in skill packs that ship with each role. These are slugs so the same
 * catalog can be shown in settings and injected into the bot's prompt. */
export const DEFAULT_SKILL_SLUGS = {
  chiefOfStaff: ["chief-of-staff-routing", "decision-briefs"],
  builder: ["project-build-plan", "implementation-checklist"],
  spark: ["idea-shaping", "creative-brief"],
  research: ["source-research", "source-briefing"],
  communications: ["message-drafting", "follow-up"],
  operations: ["process-ops", "handoff-checklist"],
  creative: ["creative-direction", "design-review"],
} as const;

/** Returns the default skill pack for a seeded role, or undefined for a custom bot. */
export function defaultSkillSlugsForBot(name: string, title = ""): string[] | undefined {
  if (isChiefOfStaffRole(name, title)) return [...DEFAULT_SKILL_SLUGS.chiefOfStaff];
  const role = ROLE_SEEDS.find((seed) => seed.title.toLowerCase() === title.trim().toLowerCase());
  if (!role) return undefined;
  const key = role.name.toLowerCase() as keyof typeof DEFAULT_SKILL_SLUGS;
  return key in DEFAULT_SKILL_SLUGS ? [...DEFAULT_SKILL_SLUGS[key]] : undefined;
}

export function roleByTitle(title: string) {
  return ROLE_SEEDS.find((r) => r.title.toLowerCase() === title.trim().toLowerCase()) ?? null;
}

export function teammateGreeting(name: string, title: string): string {
  const job = title.trim() || "not set yet";
  return `Hey — I'm ${name}. My job is ${job}. ${SLEEP_WARNING}`;
}

/** Append CoS operating rules when this bot is the Chief of Staff. */
export function withCosPrompt(bot: { name: string; title?: string }, persona: string): string {
  return isChiefOfStaffRole(bot.name, bot.title) ? `${persona}\n\n${COS_PROMPT}` : persona;
}

/** Hermes GOAP for specialists only — never dumped into CoS voice. */
export const GOAP_PROMPT = `Structure private reasoning as Hermes GOAP: Goal -> Action -> Observation -> Reflection.
Goal: the outcome this turn must produce.
Action: the next concrete step (a tool call or a write).
Observation: what that step returned.
Reflection: whether the goal is closer; if not, change the Action.

Do not print this loop in the chat bubble unless the user asked for a plan. The bubble is the result, not the worksheet.`

/** CoS keeps the short human prompt. Specialists get GOAP. */
export function withRolePrompt(bot: { name: string; title?: string }, persona: string): string {
  if (isChiefOfStaffRole(bot.name, bot.title)) return withCosPrompt(bot, persona);
  return `${persona}\n\n${GOAP_PROMPT}`;
}

const FIGHT_RE = /\b(fight|challenge|critique|rebut|red-?team)\b/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function targetAliases(to: { name: string; title?: string }): string[] {
  return [to.name, to.title ?? ""]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3);
}

/** True when a fight/challenge/critique verb is aimed at the ask target (not merely mentioned). */
function isAskTargetBeingFought(hay: string, aliases: string[]): boolean {
  return aliases.some((n) => {
    const a = escapeRe(n);
    return new RegExp(String.raw`\b(?:fight|challenge|critique|rebut|red-?team)\s+${a}\b`).test(hay);
  });
}

/** Message tells the recipient to ask_bot / query / have T write the brief being fought. */
function asksTargetToProduceFoughtBrief(message: string, aliases: string[]): boolean {
  const msg = message.toLowerCase().replace(/@/g, " ");
  const fightish = FIGHT_RE.test(msg) || /\b(?:new\s+)?brief\b/.test(msg);
  return aliases.some((n) => {
    const a = escapeRe(n);
    const ask = new RegExp(
      String.raw`\b(?:ask_bot|ask|query)\s+${a}\b|\bhave\s+${a}\s+(?:write|produce|draft|create)\b|\b${a}\s+should\s+(?:write|produce|draft|create)\b|\b${a}\s+(?:to\s+)?write\s+a\s+(?:new\s+)?brief\b`,
    );
    return ask.test(msg) && (fightish || /\b(write|produce|draft|create)\b/.test(msg));
  });
}

/**
 * True when this payload must not be sent to `to` (the ask target):
 * - the ask target is who is being fought/challenged ("fight X" → do not ask X)
 * - the message tells that target to write the brief being fought
 * Asking a critic/specialist to critique X is allowed even when the user text is "fight X".
 */
export function isForbiddenFightAsk(
  from: { name: string; title?: string; description?: string } | null | undefined,
  to: { name: string; title?: string },
  message = "",
): boolean {
  const aliases = targetAliases(to);
  if (!aliases.length) return false;
  const fromHay = `${from?.name ?? ""} ${from?.title ?? ""} ${from?.description ?? ""}`.toLowerCase();
  const msg = message.toLowerCase().replace(/@/g, " ");
  const hay = `${fromHay} ${msg}`;
  if (isAskTargetBeingFought(hay, aliases)) return true;
  if (asksTargetToProduceFoughtBrief(message, aliases)) return true;
  return false;
}

/** True when the caller is supposed to fight/challenge the target, so they may not ask_bot that target. */
export function isForbiddenSelfFight(
  from: { name: string; title?: string; description?: string },
  to: { name: string; title?: string },
  message = "",
): boolean {
  return isForbiddenFightAsk(from, to, message);
}
