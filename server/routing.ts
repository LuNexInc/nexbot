/** Small, deterministic routing hints for the Chief of Staff.
 *
 * The model still owns the conversation and the handoff message. These hints
 * make the high-confidence role matches explicit, so a specialist request is
 * not silently answered by the coordinator.
 */

export type RoutingPeer = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  enabledSkillSlugs?: string[] | null;
};

export type RoutingSuggestion = {
  peer: RoutingPeer;
  role: string;
  reason: string;
};

type Rule = {
  role: string;
  reason: string;
  signals: RegExp[];
  metadata: RegExp;
};

const RULES: Rule[] = [
  {
    // Internal capability id — never shown to the model. A peer can carry this
    // capability under any name (Builder renamed to Engineer, etc.), so the
    // metadata regex matches common titles/descriptions, not just seed names.
    role: "builder",
    reason: "projects, code, files, or implementation",
    signals: [/\b(?:build|project|code|repo|file|test|implement|ship|deploy)\b/i],
    metadata: /builder|engineer|develop(?:er|ment)?\b|coding|software|implementation|projects?|build/i,
  },
  {
    role: "Spark",
    reason: "writing, ideas, creative concepts, or positioning",
    signals: [
      /\b(?:write|writing|draft|copy|creative|idea|ideas|concept|outline|positioning|landing[- ]page)\b/i,
    ],
    metadata: /spark|writing|creative|idea|concept|creative-brief|idea-shaping/i,
  },
  {
    role: "Research",
    reason: "research, sources, citations, or a sourced briefing",
    signals: [
      /\b(?:research|source|sources|citation|citations|briefing|briefings|competitor|market analysis|evidence)\b/i,
    ],
    metadata: /research|source|brief|sourced/i,
  },
  {
    role: "Communications",
    reason: "messages, email, outreach, or follow-up",
    signals: [
      /\b(?:email|outreach|message|messages|cold[- ]email|follow[- ]up|reply)\b/i,
    ],
    metadata: /communication|message|outreach|follow-up|drafting/i,
  },
  {
    role: "Operations",
    reason: "processes, checklists, routines, or follow-through",
    signals: [
      /\b(?:process|checklist|workflow|routine|follow[- ]through|runbook|operations?)\b/i,
    ],
    metadata: /operation|process|checklist|handoff/i,
  },
  {
    role: "Creative",
    reason: "visual, brand, design, or art direction",
    signals: [
      /\b(?:design|visual|brand|logo|image|illustration|art direction|visual direction)\b/i,
    ],
    metadata: /creative|design|direction|creative-direction/i,
  },
];

function haystack(peer: RoutingPeer): string {
  return [peer.name, peer.title, peer.description, ...(peer.enabledSkillSlugs ?? [])]
    .filter(Boolean)
    .join(" ");
}

function isCoordinator(peer: RoutingPeer): boolean {
  return /chief of staff/i.test(`${peer.name} ${peer.title ?? ""}`);
}

function metadataAffinity(peer: RoutingPeer, role: string): number {
  const name = peer.name.toLowerCase();
  const title = (peer.title ?? "").toLowerCase();
  const description = (peer.description ?? "").toLowerCase();
  const skills = (peer.enabledSkillSlugs ?? []).join(" ").toLowerCase();
  const wanted = role.toLowerCase();
  // A user can deliberately configure Spark as the writing-and-research
  // teammate. That custom role should outrank the generic Research seed.
  if (wanted === "research" && /writing\s*(?:and|&)\s*research/.test(`${title} ${description}`)) return 6;
  if (name === wanted) return 5;
  if (title.startsWith(wanted) || title.includes(wanted)) return 4;
  if (description.includes(wanted)) return 3;
  if (skills.includes(wanted)) return 2;
  return 1;
}

/** Return every high-confidence specialist match, in the order to try them. */
export function suggestSpecialistRoutes(text: string, peers: RoutingPeer[]): RoutingSuggestion[] {
  const input = text.trim();
  if (!input || /^(?:hi|hey|hello|what(?:'s| is) up|thanks|thank you)\b/i.test(input)) return [];

  const candidates: Array<RoutingSuggestion & { score: number; index: number }> = [];
  for (const [index, rule] of RULES.entries()) {
    const peer = peers
      .filter((candidate) => !isCoordinator(candidate) && rule.metadata.test(haystack(candidate)))
      .sort((a, b) => metadataAffinity(b, rule.role) - metadataAffinity(a, rule.role))[0];
    if (!peer) continue;
    const signalCount = rule.signals.reduce((count, signal) => count + (signal.test(input) ? 1 : 0), 0);
    if (!signalCount) continue;
    const metadataScore = rule.metadata.test(haystack(peer)) ? 2 : 0;
    candidates.push({ peer, role: rule.role, reason: rule.reason, score: signalCount * 3 + metadataScore, index });
  }

  // A custom bot can match more than one rule. Keep it once, with the strongest
  // reason, so the Chief of Staff does not send duplicate work to one teammate.
  const unique = new Map<string, (RoutingSuggestion & { score: number; index: number })>();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.peer.id);
    if (!previous || candidate.score > previous.score) unique.set(candidate.peer.id, candidate);
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.index - b.index).map(({ score: _score, index: _index, ...suggestion }) => suggestion);
}

export function routingDirective(suggestions: RoutingSuggestion[]): string {
  if (!suggestions.length) return "";
  // Address teammates by their CURRENT name only. Seed role ids stay internal:
  // a renamed specialist (Builder → Engineer) must never see its old name.
  const assignments = suggestions
    .map((suggestion) => `@${suggestion.peer.name} (${suggestion.reason})`)
    .join("; ");
  return `Harness routing directive: this request matches ${assignments}. Before doing specialist work yourself, call list_bots and delegate the matching assignment(s) with ask_bot. Ask one teammate at a time, pass the useful result to the next teammate, then summarize the handoffs and owners for Charles. If a matched teammate is busy, report that clearly instead of silently doing their work.`;
}
