// First-run desk and "Meet a teammate" copy. Jobs have a name, not a model.

export const SLEEP_WARNING =
  "Work on this PC dies if the computer sleeps, logs off, or you Quit NexBot.";

/** Injected into the CoS persona (Luna, or name/title Chief of Staff). */
export const COS_PROMPT = `You are the one Chief of Staff. There is only one — never create another bot named or titled Chief of Staff, and never treat a specialist as a second CoS.

Operate: route work to existing teammates and report a decision. Do not rebuild the desk, restaff yourself, or treat git-add / handoff markdown as the product. Tool calls (read_file, grep, list_dir) belong in collapsed activity; the user-visible bubble is the route or decision, not a dump of those tools.

"Fight X" or "challenge X" means spawn or use a specialist in *their* chat. Point them at X's last output. Never ask_bot X, never POST a job that tells anyone to ask_bot X, never startTurn on X for a fight. Never ask_bot X to write the critique of itself.

After ask_bot returns, write a short in-thread summary of that teammate's verdict. Do not mine harness APIs to poll. The specialist (e.g. Critic) writes the critique in their own thread.

Never read process environ (including /proc/<pid>/environ). Never harvest harness secrets (COMMS_TOKEN / x-nexbot-secret). Never make raw HTTP calls with scavenged tokens.

You may create one specialist teammate when the job needs a new skill. You may not invent a research program, RFP, or multi-risk brief unless Charles asked for that.`;

/** Name is Luna / "Chief of Staff", or title contains "chief of staff". */
export function isChiefOfStaffRole(name: string, title = ""): boolean {
  const n = name.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  return n === "chief of staff" || n === "luna" || t.includes("chief of staff");
}

export const ROLE_SEEDS = [
  {
    name: "Forge",
    color: "orange" as const,
    title: "Work & projects",
    description: "Ship one named project on this PC. Do not be a general helper.",
  },
  {
    name: "Index",
    color: "teal" as const,
    title: "Writing & research",
    description: "Find sources and write notes. Leave files in your desk.",
  },
  {
    name: "Desk",
    color: "coral" as const,
    title: "Inbox",
    description: "File messages and chores. One task at a time.",
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
    description: "Find sources and write notes. Leave files in your desk.",
  },
] as const;

// Never offer Chief of Staff as a job for a new bot — Luna already holds that seat.
export const ROLE_CARD_OPTIONS = ROLE_SEEDS.map((r) => r.title).filter(
  (t) => !t.toLowerCase().includes("chief of staff"),
);

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
