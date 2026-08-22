// Turn progress tracker. A busy bot with no events is stuck.
// Empty-queue reclaim: drop busy after stuckMs with no events.
// Stream stall: warn if no token/chunk within stallMs during an active turn.

export type TurnWatch = {
  botId: string;
  /** Wall clock when the user send / startTurn began. */
  sendTimeMs: number;
  /** Alias of sendTimeMs (older callers). */
  startedAt: number;
  lastEventAt: number;
  firstTokenTimeMs?: number;
  firstTokenAt?: number;
  ttfrMs?: number;
  lastChunkAt?: number;
  events: number;
  tokens: { input: number; output: number };
  computerTools: boolean;
  stuck: boolean;
  stalled: boolean;
  stallWarned?: boolean;
};

export type Watchdog = {
  start(botId: string): void;
  recordFirstToken(botId: string): number | undefined;
  poke(
    botId: string,
    eventType?: string,
    extra?: { tokens?: { input: number; output: number }; computerTool?: boolean; isChunk?: boolean },
  ): number | undefined;
  end(botId: string): TurnWatch | null;
  get(botId: string): TurnWatch | null;
  isBudgetExceeded(botId: string, maxTokens?: number): boolean;
  stuckBots(now?: number): TurnWatch[];
  stalledBots(stallThresholdMs?: number, now?: number): TurnWatch[];
};

export const DEFAULT_STUCK_MS = 90_000;
export const DEFAULT_STALL_MS = 45_000;
export const DEFAULT_MAX_TOKENS_PER_TURN = 120_000;

export function createWatchdog(opts?: { stuckMs?: number; stallMs?: number }): Watchdog {
  const stuckMs = opts?.stuckMs ?? DEFAULT_STUCK_MS;
  const stallMs = opts?.stallMs ?? DEFAULT_STALL_MS;
  const turns = new Map<string, TurnWatch>();

  function start(botId: string) {
    const now = Date.now();
    turns.set(botId, {
      botId,
      sendTimeMs: now,
      startedAt: now,
      lastEventAt: now,
      events: 0,
      tokens: { input: 0, output: 0 },
      computerTools: false,
      stuck: false,
      stalled: false,
    });
  }

  function recordFirstToken(botId: string): number | undefined {
    const row = turns.get(botId);
    if (!row || row.firstTokenTimeMs !== undefined) return undefined;
    const now = Date.now();
    row.firstTokenTimeMs = now;
    row.firstTokenAt = now;
    row.lastChunkAt = now;
    row.ttfrMs = now - row.sendTimeMs;
    return row.ttfrMs;
  }

  function poke(
    botId: string,
    eventType?: string,
    extra?: { tokens?: { input: number; output: number }; computerTool?: boolean; isChunk?: boolean },
  ): number | undefined {
    const row = turns.get(botId);
    if (!row) return undefined;
    const now = Date.now();
    row.lastEventAt = now;
    let justTtfr: number | undefined;
    if (extra?.isChunk || eventType === "content.delta") {
      row.lastChunkAt = now;
      if (row.firstTokenTimeMs === undefined) {
        row.firstTokenTimeMs = now;
        row.firstTokenAt = now;
        row.ttfrMs = now - row.sendTimeMs;
        justTtfr = row.ttfrMs;
      }
    }
    row.events += 1;
    row.stuck = false;
    row.stalled = false;
    row.stallWarned = false;
    if (extra?.tokens) row.tokens = extra.tokens;
    if (extra?.computerTool) row.computerTools = true;
    if (eventType && /computer|cua|screenshot|desktop/i.test(eventType)) row.computerTools = true;
    return justTtfr;
  }

  function end(botId: string): TurnWatch | null {
    const row = turns.get(botId) ?? null;
    turns.delete(botId);
    return row;
  }

  function get(botId: string): TurnWatch | null {
    return turns.get(botId) ?? null;
  }

  function stuckBots(now = Date.now()): TurnWatch[] {
    const out: TurnWatch[] = [];
    for (const row of turns.values()) {
      if (now - row.lastEventAt >= stuckMs) {
        row.stuck = true;
        out.push(row);
      }
    }
    return out;
  }

  function stalledBots(customStallMs = stallMs, now = Date.now()): TurnWatch[] {
    const out: TurnWatch[] = [];
    for (const row of turns.values()) {
      if (row.stallWarned) continue;
      const last = row.lastChunkAt ?? row.sendTimeMs;
      if (now - last >= customStallMs) {
        row.stalled = true;
        row.stallWarned = true;
        out.push(row);
      }
    }
    return out;
  }

  function isBudgetExceeded(botId: string, maxTokens = DEFAULT_MAX_TOKENS_PER_TURN): boolean {
    const row = turns.get(botId);
    if (!row) return false;
    const total = (row.tokens.input ?? 0) + (row.tokens.output ?? 0);
    return total > maxTokens;
  }

  return { start, recordFirstToken, poke, end, get, isBudgetExceeded, stuckBots, stalledBots };
}

export function isComputerToolName(name: string | undefined): boolean {
  if (!name) return false;
  return /computer|cua|screenshot|desktop|mcp__computer/i.test(name);
}
