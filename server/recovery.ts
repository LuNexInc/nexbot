// Settle in-flight turns left in pending-turns.json after a crash or kill.
// Runs before HTTP/SSE so a dead session cannot look still-busy or auto-replay.
import { integrityCheck, walCheckpoint } from "./db.ts";
import { forgetTurn, listPending } from "./pending.ts";
import type { Store } from "./store.ts";

export function sessionDeathSettlement(store: Store): number {
  try {
    const result = integrityCheck();
    if (result !== "ok") console.error(`nexbot store.db integrity_check: ${result}`);
  } catch (e) {
    console.error("nexbot store.db integrity_check failed", e);
  }
  try {
    walCheckpoint();
  } catch {
    /* brand-new or already closed */
  }
  const pending = listPending();
  let n = 0;
  for (const p of pending) {
    forgetTurn(p.botId);
    const bot = store.bot(p.botId);
    if (!bot) continue;
    store.patchBot(bot.id, { busy: false });
    store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: "previous session ended before this turn finished", ok: false },
    });
    n += 1;
  }
  return n;
}
