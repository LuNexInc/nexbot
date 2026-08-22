// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors). Persist the
// binding from day one. messages-<threadId>.json holds the folded transcript.
import { mkdirSync } from "node:fs";
import { appendMessage as appendMessageToDb, clearExplicitWipeMarker, deleteBotRow, deleteThread, importJsonIfNeeded, loadBotsFromDb, loadThreadMessagesFromDb, openStoreDb, patchMessage as patchMessageInDb, persistBot, persistBots, wasExplicitlyWiped } from "./db.ts";

import { DATA_DIR } from "./config.ts";
import { newId, type ModelSelection, type ThreadId } from "./contracts.ts";
import { ensureDesk, writeProfile } from "./desk.ts";
import { defaultSkillSlugsForBot, ROLE_CARD_OPTIONS, TEAM_SEEDS, SLEEP_WARNING, teammateGreeting, isChiefOfStaffRole, DEFAULT_COS_ROUTINE } from "./roles.ts";
import { removeJobsForBot } from "./jobs.ts";
import { createRoutine, listRoutines } from "./routines.ts";

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
  risk?: "low" | "medium" | "high" | "critical";
  riskReason?: string;
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen";
  text?: string;
  /** Provider reasoning summary, kept out of the main answer bubble. */
  reasoning?: string;
  /** Turn effort metrics shown in the collapsed reasoning disclosure. */
  effort?: TurnEffort;
  card?: OptionCardData;
  /** activity messages: tool name + outcome */
  tool?: {
    name: string;
    ok?: boolean;
    receiptId?: string;
    evidence?: "not_requested" | "pending" | "changed" | "unchanged" | "unavailable";
  };
  /** screen messages: a frame of the bot's computer (base64 image) */
  png?: string;
  mime?: string;
  /** teammate speaking in this thread (ask_bot / A2A) */
  fromBot?: { id: string; name: string; color?: string };
  /** why an internal message was added to the transcript */
  source?: "user" | "agent" | "routine" | "proactive" | "completion";
  at: number;
  /** client nonce for optimistic send and deduplication */
  clientNonce?: string;
  /** delivery status for optimistic UI */
  status?: "pending" | "confirmed" | "failed";
  /** Local artifacts attached to an assistant reply. Paths are served through /api/artifacts. */
  files?: Array<{ name: string; path: string; mime?: string }>;
  /** Claim-vs-evidence honesty signal for an assistant reply. Present only when
   * the turn's receipts contradict or cannot confirm the reply's claim. */
  claimEvidence?: {
    verdict: "verified" | "partially_verified" | "unverified";
    note: string;
    flagged: number;
  };
}

export interface TurnEffort {
  durationMs?: number;
  reasoningTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCount?: number;
  cost?: number | null;
}

export interface BotRecord {
  id: string;
  threadId: ThreadId;
  name: string;
  title: string;
  description: string;
  /** Optional talking-style guidance layered into the bot persona. */
  personality?: string;
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
  /** Per-bot access mode, like a modern CLI permission flag.
   * readonly: only read-only actions auto-allowed.
   * workspace (default): reads + reversible local actions auto-allowed.
   * full: reads + local + durable/destructive auto-allowed; critical still
   * gates unless allowCriticalActions is true. */
  permissionMode?: "readonly" | "workspace" | "full";
  /** Only meaningful for full: when true, critical actions (credentials,
   * money, publish, send external) are also auto-allowed (true bypass). */
  allowCriticalActions?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  busy?: boolean;
  /** True while the user has paused the agent to control the computer. */
  operatorControl?: boolean;
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
  /** Allow task events to wake this agent without a user prompt. */
  proactiveEnabled?: boolean;
  /** Send this bot's completed-task reports to the Chief of Staff. */
  completionPings?: boolean;
  /** Stable specialist order in the sidebar. Chief of Staff is always first. */
  sortOrder?: number;
  createdAt: number;
}

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

// Keep provider replay small. Full history remains in SQLite and the local
// conversation archive; this is only the active prompt window.
export const TRANSCRIPT_WINDOW = 12;
export const TRANSCRIPT_TEXT_CAP = 3_000;

/** Last-12 text turns for sendTurn. Cap each body so a huge paste cannot blow context,
 * without shrinking the window. */
export function clipForTurn(
  messages: Pick<Message, "kind" | "role" | "fromBot" | "text" | "status">[],
  options: { window?: number; textCap?: number } = {},
): { role: "user" | "assistant"; text: string }[] {
  const window = Number.isFinite(options.window) ? Math.max(1, Math.floor(options.window!)) : TRANSCRIPT_WINDOW;
  const textCap = Number.isFinite(options.textCap) ? Math.max(1, Math.floor(options.textCap!)) : TRANSCRIPT_TEXT_CAP;
  return messages
    .filter((m) => m.kind === "text" && m.status !== "pending" && (m.text ?? "").trim())
    .slice(-window)
    .map((m) => {
      const raw = m.text ?? "";
      return {
        role: (m.role === "user" && !m.fromBot ? "user" : "assistant") as "user" | "assistant",
        text: raw.length > textCap ? raw.slice(0, textCap) : raw,
      };
    });
}

const onboardingCard = (): OptionCardData => ({
  title: "What is this NexBot's job?",
  subtitle: "Pick a role, not a model. You can change the name later.",
  options: [...ROLE_CARD_OPTIONS],
});

export type CreateBotSpec = Partial<
  Pick<BotRecord, "name" | "title" | "description" | "personality" | "color" | "kind" | "memberIds" | "modelSelection" | "enabledSkillSlugs" | "permissionMode" | "allowCriticalActions">
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
  /** Per-thread transcript cache. SQLite is the source of truth; threads
   * load on first access and the least-recently-used ones are evicted so a
   * long-lived workspace cannot grow memory without bound. */
  private messages = new Map<string, Message[]>();
  private defaultSelection: () => ModelSelection;

  constructor(defaultSelection: () => ModelSelection) {
    this.defaultSelection = defaultSelection;
    mkdirSync(DATA_DIR, { recursive: true });
    openStoreDb();
    importJsonIfNeeded();
    this.bots = loadBotsFromDb();
    // busy never survives a restart. Provider cursors do: recovery uses them
    // to resume a job that was active when the process exited.
    // unread DOES: persistBots writes the whole BotRecord; do not strip it here.
    let defaultsChanged = false;
    for (const b of this.bots) {
      b.busy = false;
      if (b.sortOrder === undefined) {
        b.sortOrder = this.bots.indexOf(b);
        defaultsChanged = true;
      }
      if (!b.resumeCursors || typeof b.resumeCursors !== "object") {
        b.resumeCursors = {};
        defaultsChanged = true;
      }
      const legacy = b as BotRecord & { proactiveIntervalMinutes?: unknown; proactiveLastAt?: unknown };
      if ("proactiveIntervalMinutes" in legacy || "proactiveLastAt" in legacy) {
        delete legacy.proactiveIntervalMinutes;
        delete legacy.proactiveLastAt;
        defaultsChanged = true;
      }
      if (b.proactiveEnabled === undefined) {
        b.proactiveEnabled = b.kind !== "group";
        defaultsChanged = true;
      }
      if (b.completionPings === undefined) {
        b.completionPings = b.kind !== "group";
        defaultsChanged = true;
      }
      if (b.enabledSkillSlugs === undefined) {
        const defaults = defaultSkillSlugsForBot(b.name, b.title);
        if (defaults) {
          b.enabledSkillSlugs = defaults;
          defaultsChanged = true;
        }
      }
    }
    if (defaultsChanged) this.saveBots();
  }

  private saveBots() {
    persistBots(this.bots);
  }

  clearAll(): void {
    this.bots = [];
    this.messages.clear();
    this.idIndex.clear();
  }

  /** Threads kept in memory before the least-recently-used one is evicted.
   * Eviction is safe: every mutation writes through to SQLite immediately. */
  private static readonly MAX_LOADED_THREADS = 64;

  /** messageId → its position in the cached thread array. Threads are
   * append-only (never spliced mid-list), so positions stay stable while a
   * thread stays cached; entries are lazily validated and fall back to a
   * scan, so eviction/deletion can never produce a wrong hit. */
  private static readonly MAX_ID_INDEX = 120_000;
  private idIndex = new Map<string, { threadId: string; index: number }>();

  private indexThread(threadId: string, list: Message[]): void {
    for (let i = 0; i < list.length; i++) {
      this.idIndex.set(list[i]!.id, { threadId, index: i });
    }
    this.trimIdIndex();
  }

  private trimIdIndex(): void {
    while (this.idIndex.size > Store.MAX_ID_INDEX) {
      const oldest = this.idIndex.keys().next().value;
      if (oldest === undefined) break;
      this.idIndex.delete(oldest);
    }
  }

  /** O(1) message lookup by id (validated against the cached array, with a
   * scan fallback), instead of a linear pass over the whole thread. */
  getMessage(threadId: string, messageId: string): Message | null {
    const hit = this.idIndex.get(messageId);
    if (hit && hit.threadId === threadId) {
      const m = this.messagesFor(threadId)[hit.index];
      if (m && m.id === messageId) return m;
    }
    return this.messagesFor(threadId).find((m) => m.id === messageId) ?? null;
  }

  messagesFor(threadId: string): Message[] {
    let list = this.messages.get(threadId);
    if (!list) {
      list = loadThreadMessagesFromDb(threadId);
      this.messages.set(threadId, list);
      this.indexThread(threadId, list);
      this.evictStaleThreads();
      return list;
    }
    // Refresh recency (Map iteration order is insertion order).
    this.messages.delete(threadId);
    this.messages.set(threadId, list);
    return list;
  }

  private evictStaleThreads(): void {
    while (this.messages.size > Store.MAX_LOADED_THREADS) {
      const oldest = this.messages.keys().next().value;
      if (oldest === undefined) break;
      this.messages.delete(oldest);
    }
  }

  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message {
    const full: Message = { id: newId(), at: Date.now(), ...message };
    const list = this.messagesFor(threadId);
    list.push(full);
    this.idIndex.set(full.id, { threadId, index: list.length - 1 });
    this.trimIdIndex();
    const bot = this.botByThread(threadId);
    appendMessageToDb(threadId, full, bot?.id);
    return full;
  }

  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null {
    const list = this.messagesFor(threadId);
    const hit = this.idIndex.get(messageId);
    const idx = hit && hit.threadId === threadId && list[hit.index]?.id === messageId
      ? hit.index
      : list.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx]!, ...patch, card: patch.card ?? list[idx]!.card };
    patchMessageInDb(threadId, list[idx]!);
    return list[idx]!;
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
    clearExplicitWipeMarker();
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
      personality: spec?.personality?.trim() || undefined,
      notifications: true,
      color: spec?.color ?? COLORS[this.bots.length % COLORS.length],
      computer: isGroup ? "off" : "local",
      permissionMode: spec?.permissionMode ?? "workspace",
      allowCriticalActions: spec?.allowCriticalActions ?? false,
      // The Chief of Staff is the continuity layer. Keep its durable memory
      // on by default so a short active context never becomes lost history.
      memoryEnabled: isChiefOfStaffName(name, title),
      enabledSkillSlugs: spec?.enabledSkillSlugs ?? defaultSkillSlugsForBot(name, title),
      unread: false,
      modelSelection: spec?.modelSelection ?? this.defaultSelection(),
      resumeCursors: {},
      proactiveEnabled: !isGroup,
      completionPings: !isGroup,
      sortOrder: this.bots.reduce((max, item) => Math.max(max, item.sortOrder ?? -1), -1) + 1,
      kind: isGroup ? "group" : "bot",
      memberIds: isGroup ? members : undefined,
      createdAt: Date.now(),
    };
    this.bots.unshift(bot);
    persistBot(bot);
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
    deleteBotRow(bot.id);
    deleteThread(bot.threadId);
    removeJobsForBot(id);
    return true;
  }

  patchBot(id: string, patch: Partial<BotRecord>, opts: { persist?: boolean } = {}): BotRecord | null {
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
    if (next.personality !== undefined) next.personality = String(next.personality).trim().slice(0, 4000) || undefined;
    if (next.sortOrder !== undefined) {
      const order = Number(next.sortOrder);
      next.sortOrder = Number.isFinite(order) ? Math.max(0, Math.floor(order)) : bot.sortOrder;
    }
    Object.assign(bot, next);
    // High-frequency callers (token-usage ticks) can skip the row write; the
    // next persisted patch (e.g. busy:false at turn end) carries the value.
    if (opts.persist !== false) persistBot(bot);
    return bot;
  }

  setResumeCursor(botId: string, instanceId: string, cursor: unknown) {
    const bot = this.bot(botId);
    if (!bot) return;
    bot.resumeCursors = { ...(bot.resumeCursors ?? {}), [instanceId]: cursor };
    persistBot(bot);
  }

  /** First-run seed: Chief of Staff + Research. Never wipes an existing roster. */
  seedIfEmpty() {
    if (this.bots.length || wasExplicitlyWiped()) return;
    this.ensureTeamSeeds();
  }

  /** Add Chief of Staff + Research if missing. Never deletes or renames existing bots.
   * Skip CoS when any bot already holds that seat (Luna, name, or title). */
  ensureTeamSeeds() {
    if (wasExplicitlyWiped()) return;
    for (const spec of [...TEAM_SEEDS].reverse()) {
      const exists = this.bots.some((b) => {
        if (b.kind === "group") return false;
        if (spec.name === "Chief of Staff") return isChiefOfStaffName(b.name, b.title);
        return teamSeedMatches(b.name, spec.name);
      });
      if (exists) continue;
      const isCos = spec.name === "Chief of Staff";
      const bot = this.createBot({
        name: spec.name,
        title: spec.title,
        description: spec.description,
        color: spec.color,
        ...(isCos ? { modelSelection: { instanceId: "antigravity", model: "gemini-3.7-flash-medium" } } : {}),
      });
      this.patchBot(bot.id, { memoryEnabled: true });
      writeProfile(bot.id, spec.description);
    }
    // Existing workspaces may have been created before CoS memory or Antigravity
    // became the default. Migrate that seat without changing specialists.
    for (const bot of this.bots) {
      if (bot.kind !== "group" && isChiefOfStaffName(bot.name, bot.title)) {
        const patches: Partial<BotRecord> = {};
        if (!bot.memoryEnabled) patches.memoryEnabled = true;
        if (!bot.modelSelection || !bot.modelSelection.instanceId) {
          patches.modelSelection = { instanceId: "antigravity", model: "gemini-3.7-flash-medium" };
        }
        if (Object.keys(patches).length) this.patchBot(bot.id, patches);
        const routines = listRoutines(bot.id);
        if (!routines.some((r) => r.name === DEFAULT_COS_ROUTINE.name)) {
          createRoutine({
            botId: bot.id,
            name: DEFAULT_COS_ROUTINE.name,
            prompt: DEFAULT_COS_ROUTINE.prompt,
            dailyAt: DEFAULT_COS_ROUTINE.dailyAt,
            weekdaysOnly: DEFAULT_COS_ROUTINE.weekdaysOnly,
            enabled: true,
          });
        }
      }
    }
  }
}
