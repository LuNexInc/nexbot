import type { Bot } from "@/state/types";

export interface ClarificationChoice {
  bot: Bot;
  reason: string;
}

const ROLE_ORDER = ["research", "spark", "builder", "communications", "operations", "creative"] as const;

const ROLE_RULES: Array<{ key: (typeof ROLE_ORDER)[number]; terms: RegExp; reason: string }> = [
  { key: "research", terms: /research|source|citation|briefing|competitor|market|analysis|find out|investigate/i, reason: "Research and briefings" },
  { key: "spark", terms: /write|draft|copy|idea|creative|concept|outline|positioning|landing page|brainstorm/i, reason: "Writing and creative work" },
  { key: "builder", terms: /build|project|code|repo|file|test|implement|ship|deploy|prototype/i, reason: "Projects and builds" },
  { key: "communications", terms: /email|outreach|message|follow[- ]?up|reply|announcement|pitch/i, reason: "Messages and outreach" },
  { key: "operations", terms: /process|checklist|workflow|routine|schedule|organize|follow[- ]?through/i, reason: "Processes and follow-through" },
  { key: "creative", terms: /design|visual|brand|logo|image|art direction/i, reason: "Design and direction" },
];

const VAGUE_ACTION = /\b(help|handle|work on|fix|improve|make|create|plan|figure out|take care of|deal with|look into|do something|need|want)\b/i;
const CASUAL = /^(?:hi|hey|hello|yo|what(?:'s| is) up|thanks|thank you)\b/i;

function haystack(bot: Bot): string {
  return `${bot.name} ${bot.title} ${bot.description}`.toLowerCase();
}

function roleAffinity(bot: Bot, key: (typeof ROLE_ORDER)[number]): number {
  const rule = ROLE_RULES.find((entry) => entry.key === key);
  if (!rule) return 0;
  const value = haystack(bot);
  if (key === "spark" && /writing\s*(?:and|&)\s*research/.test(value)) return 7;
  if (rule.terms.test(value)) return 5;
  return 0;
}

export function isChiefOfStaff(bot: Bot): boolean {
  return /chief\s+of\s+staff/i.test(`${bot.name} ${bot.title}`);
}

/** Return true only for an action request with no clear specialist signal. */
export function shouldAskClarification(text: string, bot: Bot): boolean {
  const value = text.trim();
  if (!value || !isChiefOfStaff(bot) || CASUAL.test(value) || !VAGUE_ACTION.test(value)) return false;
  return !ROLE_RULES.some((rule) => rule.terms.test(value));
}

/** Pick the two or three most likely visible teammates for the clarification card. */
export function getClarificationChoices(text: string, bots: Bot[], currentBotId: string): ClarificationChoice[] {
  const value = text.trim();
  const candidates = bots
    .filter((bot) => bot.id !== currentBotId && !bot.hidden)
    .map((bot) => {
      const ranked = ROLE_ORDER.map((key, index) => ({ key, score: roleAffinity(bot, key), index }))
        .sort((a, b) => b.score - a.score || a.index - b.index)[0];
      return {
        bot,
        score: ranked?.score ?? 0,
        roleIndex: ranked?.index ?? ROLE_ORDER.length,
        reason: ranked?.score ? ROLE_RULES.find((rule) => rule.key === ranked.key)?.reason ?? "Specialist teammate" : "Specialist teammate",
      };
    })
    .sort((a, b) => b.score - a.score || a.roleIndex - b.roleIndex || a.bot.name.localeCompare(b.bot.name));

  // A roster without role metadata is not useful for a safe choice card.
  const ranked = candidates.filter((candidate) => candidate.score > 0).slice(0, 3);
  if (ranked.length >= 2) return ranked.map(({ bot, reason }) => ({ bot, reason }));

  // If the request contains a hint that is not strong enough to auto-route,
  // still show the best available peers. This keeps the UI useful for custom roles.
  if (value) return candidates.slice(0, 3).map(({ bot, reason }) => ({ bot, reason }));
  return [];
}

export function buildRoutingMessage(text: string, choice?: Bot): string {
  if (choice) return `@${choice.name} ${text.trim()}`;
  return text.trim();
}
