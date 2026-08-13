// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId, type ModelSelection, type ThreadId } from "./contracts.ts";
import { ensureDesk, writeProfile } from "./desk.ts";
import { ROLE_CARD_OPTIONS, TEAM_SEEDS, SLEEP_WARNING, teammateGreeting, isChiefOfStaffRole } from "./roles.ts";

export type NexColor =
  | "green"
  | "blue"
  | "red"
  | "orange"
  | "purple"
  | "cyan"
  | "pink"
  | "yellow"
  | "teal"
  | "coral";

export type NexExpression =
  | "deadpan"
  | "friendly"
  | "focused"
  | "thinking"
  | "excited"
  | "sleepy"
  | "surprised"
  | "skeptical"
  | "worried"
  | "mischievous";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  /** Mask the free-text answer (API keys, tokens). */
  secret?: boolean;
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen";
  text?: string;
  card?: OptionCardData;
  /** activity messages: tool name + outcome */
  tool?: { name: string; ok?: boolean };
  /** screen messages: a frame of the bot's computer (base64 image) */
  png?: string;
  mime?: string;
  /** teammate speaking in this thread (ask_bot / A2A) */
  fromBot?: { id: string; name: string; color?: string };
  at: number;
  /** client nonce for optimistic send and deduplication */
  clientNonce?: string;
  /** delivery status for optimistic UI */
  status?: "pending" | "confirmed" | "failed";
}

export interface BotRecord {
  id: string;
  threadId: ThreadId;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: NexColor;
  mascotExpression?: NexExpression | null;
  unread: boolean;
  modelSelection: ModelSelection;
  /** provider-native continuation per instance (e.g. claude session id) */
  resumeCursors: Record<string, unknown>;
  /** which computer the bot acts on: its cloud box, this Mac (local CUA),
   * or none. Unset = auto (box when it exists, else local when available). */
  computer?: "cloud" | "local" | "off";
  pinned?: boolean;
  hidden?: boolean;
  busy?: boolean;
  /** When true, startTurn injects ~/.nexbot/memory/<id>/profile.md + log/YYYY-MM.md into the system prompt. */
  memoryEnabled?: boolean;
  /** null/missing = all desk skills on; string[] = only those slugs for this bot. */
  enabledSkillSlugs?: string[] | null;
  /** group = shared transcript; memberIds are other bots (2–6). */
  kind?: "bot" | "group";
  memberIds?: string[];
  usage?: { input: number; output: number };
  /** Time to first token in milliseconds from last turn */
  lastTtfrMs?: number;
  createdAt: number;
}

const BOTS_FILE = join(DATA_DIR, "bots.json");
const messagesFile = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);

const COLORS: NexColor[] = [
  "green",
  "blue",
  "red",
  "orange",
  "purple",
  "cyan",
  "pink",
  "yellow",
  "teal",
  "coral",
];

/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, names match case-insensitively, longest name wins (so "@New Bot 2"
 * never half-matches "New Bot"), hidden bots skipped, results deduped.
 * Callers pre-filter the sender out of `peers`. */
export function mentionedBots<T extends { name: string; hidden?: boolean }>(text: string, peers: T[]): T[] {
  const candidates = peers
    .filter((p) => !p.hidden && p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  const found: T[] = [];
  let at = -1;
  while ((at = lower.indexOf("@", at + 1)) !== -1) {
    if (at > 0 && !/\s/.test(text[at - 1])) continue; // user@host, not a tag
    const rest = lower.slice(at + 1);
    const hit = candidates.find((p) => rest.startsWith(p.name.toLowerCase()));
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

export const TRANSCRIPT_WINDOW = 30;
export const TRANSCRIPT_TEXT_CAP = 4_000;

/** Last-30 text turns for sendTurn. Cap each body so a huge paste cannot blow context,
 * without shrinking the window. */
export function clipForTurn(
  messages: Pick<Message, "kind" | "role" | "fromBot" | "text">[],
): { role: "user" | "assistant"; text: string }[] {
  return messages
    .filter((m) => m.kind === "text" && (m.text ?? "").trim())
    .slice(-TRANSCRIPT_WINDOW)
    .map((m) => {
      const raw = m.text ?? "";
      return {
        role: (m.role === "user" && !m.fromBot ? "user" : "assistant") as "user" | "assistant",
        text: raw.length > TRANSCRIPT_TEXT_CAP ? raw.slice(0, TRANSCRIPT_TEXT_CAP) : raw,
      };
    });
}

const onboardingCard = (): OptionCardData => ({
  title: "What is this teammate's job?",
  subtitle: "Pick a job, not a model. You can change the name later.",
  options: [...ROLE_CARD_OPTIONS],
});

export type CreateBotSpec = Partial<
  Pick<BotRecord, "name" | "title" | "description" | "color" | "kind" | "memberIds">
>;


/** Charles's live Chief of Staff is named Luna — treat it as CoS.
 * Title containing "chief of staff" also counts so a renamed seat is still unique. */
export function isChiefOfStaffName(name: string, title = ""): boolean {
  return isChiefOfStaffRole(name, title);
}


/** One CoS only. If a seat already exists, a new/patched identity that would
 * also be CoS (Luna, name, or title) is demoted to Specialist — same rule for
 * create and PATCH so the roster cannot mint a second CoS by rename. */
export function uniqueCosIdentity(
  name: string,
  title: string,
  alreadyHasCos: boolean,
): { name: string; title: string } {
  if (!alreadyHasCos || !isChiefOfStaffName(name, title)) return { name, title };
  return {
    name: isChiefOfStaffName(name) ? "Specialist" : name,
    title: title.toLowerCase().includes("chief of staff") ? "Specialist" : title,
  };
}


/** Case-insensitive name match for TEAM_SEEDS. Groups are skipped by callers.
 * "Luna" already fills the Chief of Staff seed so we never duplicate CoS. */
export function teamSeedMatches(botName: string, seedName: string): boolean {
  const a = botName.trim().toLowerCase();
  const b = seedName.trim().toLowerCase();
  if (a === b) return true;
  return b === "chief of staff" && isChiefOfStaffName(botName);
}

export type HandoffPeer = {
  id: string;
  threadId: string;
  name: string;
  hidden?: boolean;
  kind?: string;
};

/** Prefer Luna (the live CoS), else a bot named "Chief of Staff", else title match.
 * Hidden/groups skipped. One CoS only — callers must not create a second. */
export function findChiefOfStaffBot<T extends HandoffPeer & { title?: string }>(bots: T[]): T | null {
  const visible = bots.filter((b) => !b.hidden && b.kind !== "group");
  return (
    visible.find((b) => b.name.trim().toLowerCase() === "luna") ??
    visible.find((b) => b.name.trim().toLowerCase() === "chief of staff") ??
    visible.find((b) => isChiefOfStaffRole(b.name, b.title ?? "")) ??
    null
  );
}

/** Threads that should show a handoff: sender (if from a bot), recipient,
 * and CoS when CoS is neither party. Luna counts as CoS. */
export function handoffThreadIds(opts: {
  from?: { id: string } | null;
  to: { id: string };
  bots: HandoffPeer[];
}): string[] {
  const threads = new Set<string>();
  if (opts.from) {
    const sender = opts.bots.find((b) => b.id === opts.from!.id);
    if (sender) threads.add(sender.threadId);
  }
  const recipient = opts.bots.find((b) => b.id === opts.to.id);
  if (recipient) threads.add(recipient.threadId);
  const cos = findChiefOfStaffBot(opts.bots);
  if (cos && cos.id !== opts.from?.id && cos.id !== opts.to.id) threads.add(cos.threadId);
  return [...threads];
}

export class Store {
  bots: BotRecord[] = [];
  private messages = new Map<string, Message[]>();
  private defaultSelection: () => ModelSelection;

  constructor(defaultSelection: () => ModelSelection) {
    this.defaultSelection = defaultSelection;
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
    } catch {
      this.bots = [];
    }
    // busy never survives a restart — no turn does either.
    // unread DOES: saveBots writes the whole BotRecord; do not strip it here.
    for (const b of this.bots) {
      b.busy = false;
      b.resumeCursors = {};
    }
    this.loadTranscripts();
  }

  /** Load persisted chat logs. Screen frames drop their png (too large). */
  private loadTranscripts() {
    for (const b of this.bots) {
      try {
        const raw = JSON.parse(readFileSync(messagesFile(b.threadId), "utf8"));
        if (Array.isArray(raw)) this.messages.set(b.threadId, raw);
      } catch {
        /* first run or missing file */
      }
    }
  }

  private saveMessages(threadId: string) {
    const list = this.messages.get(threadId) ?? [];
    const slim = list.map((m) => (m.kind === "screen" ? { ...m, png: undefined } : m));
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(messagesFile(threadId), JSON.stringify(slim));
  }

  private saveBots() {
    writeFileSync(BOTS_FILE, JSON.stringify(this.bots, null, 2));
  }

  messagesFor(threadId: string): Message[] {
    let list = this.messages.get(threadId);
    if (!list) {
      list = [];
      this.messages.set(threadId, list);
    }
    return list;
  }

  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message {
    const full: Message = { id: newId(), at: Date.now(), ...message };
    this.messagesFor(threadId).push(full);
    this.saveMessages(threadId);
    return full;
  }

  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null {
    const list = this.messagesFor(threadId);
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };
    this.saveMessages(threadId);
    return list[idx];
  }

  bot(id: string) {
    return this.bots.find((b) => b.id === id) ?? null;
  }

  botByThread(threadId: string) {
    return this.bots.find((b) => b.threadId === threadId) ?? null;
  }

  hasChiefOfStaff(): boolean {
    return this.bots.some((b) => b.kind !== "group" && isChiefOfStaffName(b.name, b.title));
  }

  createBot(spec?: CreateBotSpec): BotRecord {
    const isGroup = spec?.kind === "group";
    let name = spec?.name?.trim() || (isGroup ? "Team" : "New Bot");
    let title = spec?.title?.trim() || (isGroup ? "Group thread" : "");
    // Groups never hold the CoS seat — demote CoS-shaped names so @Chief of Staff
    // cannot fan out to a group instead of Luna.
    ({ name, title } = uniqueCosIdentity(name, title, isGroup || this.hasChiefOfStaff()));
    const members = (spec?.memberIds ?? []).filter(Boolean).slice(0, 6);
    const bot: BotRecord = {
      id: newId(),
      threadId: newId(),
      name,
      title,
      description: spec?.description?.trim() || "",
      notifications: true,
      color: spec?.color ?? COLORS[this.bots.length % COLORS.length],
      computer: isGroup ? "off" : "local",
      memoryEnabled: false,
      unread: false,
      modelSelection: this.defaultSelection(),
      resumeCursors: {},
      kind: isGroup ? "group" : "bot",
      memberIds: isGroup ? members : undefined,
      createdAt: Date.now(),
    };
    this.bots.unshift(bot);
    this.saveBots();
    ensureDesk(bot.id);
    if (isGroup) {
      this.appendMessage(bot.threadId, {
        role: "bot",
        kind: "text",
        text: `This is a group thread. ${members.length} teammates can take the job. ${SLEEP_WARNING}`,
      });
      return bot;
    }
    this.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      text: teammateGreeting(bot.name, bot.title),
    });
    this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
    return bot;
  }

  isLastChiefOfStaff(id: string): boolean {
    const bot = this.bot(id);
    if (!bot || bot.kind === "group" || !isChiefOfStaffName(bot.name, bot.title)) return false;
    return !this.bots.some(
      (b) => b.id !== id && b.kind !== "group" && isChiefOfStaffName(b.name, b.title),
    );
  }

  deleteBot(id: string): boolean {
    const bot = this.bot(id);
    if (!bot) return false;
    if (this.isLastChiefOfStaff(id)) return false;
    this.bots = this.bots.filter((b) => b.id !== id);
    this.messages.delete(bot.threadId);
    this.saveBots();
    try {
      unlinkSync(messagesFile(bot.threadId));
    } catch {}
    return true;
  }

  patchBot(id: string, patch: Partial<BotRecord>): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    const next: Partial<BotRecord> = { ...patch };
    if (next.name !== undefined || next.title !== undefined) {
      const name = next.name !== undefined ? String(next.name) : bot.name;
      const title = next.title !== undefined ? String(next.title) : bot.title;
      const otherCos =
        bot.kind === "group" ||
        this.bots.some(
          (b) => b.id !== id && b.kind !== "group" && isChiefOfStaffName(b.name, b.title),
        );
      const unique = uniqueCosIdentity(name, title, otherCos);
      if (next.name !== undefined) next.name = unique.name;
      if (next.title !== undefined) next.title = unique.title;
    }
    Object.assign(bot, next);
    this.saveBots();
    return bot;
  }

  setResumeCursor(_botId: string, _instanceId: string, _cursor: unknown) {
    /* history off — do not persist provider sessions */
  }

  /** First-run seed: Chief of Staff + Research. Never wipes an existing roster. */
  seedIfEmpty() {
    if (this.bots.length) return;
    this.ensureTeamSeeds();
  }

  /** Add Chief of Staff + Research if missing. Never deletes or renames existing bots.
   * Skip CoS when any bot already holds that seat (Luna, name, or title). */
  ensureTeamSeeds() {
    for (const spec of [...TEAM_SEEDS].reverse()) {
      const exists = this.bots.some((b) => {
        if (b.kind === "group") return false;
        if (spec.name === "Chief of Staff") return isChiefOfStaffName(b.name, b.title);
        return teamSeedMatches(b.name, spec.name);
      });
      if (exists) continue;
      const bot = this.createBot({
        name: spec.name,
        title: spec.title,
        description: spec.description,
        color: spec.color,
      });
      this.patchBot(bot.id, { memoryEnabled: true });
      writeProfile(bot.id, spec.description);
    }
  }
}
