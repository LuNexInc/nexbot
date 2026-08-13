// Turn progress tracker. A busy bot with no events is stuck.
// Empty-queue reclaim: drop busy after stuckMs with no events.

export type TurnWatch = {
  botId: string;
  startedAt: number;
  lastEventAt: number;
  events: number;
  tokens: { input: number; output: number };
  computerTools: boolean;
  stuck: boolean;
};

export type Watchdog = {
  start(botId: string): void;
  poke(botId: string, eventType?: string, extra?: { tokens?: { input: number; output: number }; computerTool?: boolean }): void;
  end(botId: string): TurnWatch | null;
  get(botId: string): TurnWatch | null;
  stuckBots(now?: number): TurnWatch[];
};

export const DEFAULT_STUCK_MS = 90_000;

export function createWatchdog(opts?: { stuckMs?: number }): Watchdog {
  const stuckMs = opts?.stuckMs ?? DEFAULT_STUCK_MS;
  const turns = new Map<string, TurnWatch>();

  function start(botId: string) {
    const now = Date.now();
    turns.set(botId, {
      botId,
      startedAt: now,
      lastEventAt: now,
      events: 0,
      tokens: { input: 0, output: 0 },
      computerTools: false,
      stuck: false,
    });
  }

  function poke(
    botId: string,
    eventType?: string,
    extra?: { tokens?: { input: number; output: number }; computerTool?: boolean },
  ) {
    const row = turns.get(botId);
    if (!row) return;
    row.lastEventAt = Date.now();
    row.events += 1;
    row.stuck = false;
    if (extra?.tokens) row.tokens = extra.tokens;
    if (extra?.computerTool) row.computerTools = true;
    if (eventType && /computer|cua|screenshot|desktop/i.test(eventType)) row.computerTools = true;
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

  return { start, poke, end, get, stuckBots };
}

export function isComputerToolName(name: string | undefined): boolean {
  if (!name) return false;
  return /computer|cua|screenshot|desktop|mcp__computer/i.test(name);
}
