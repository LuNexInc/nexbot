// Settle in-flight turns left in pending-turns.json after a crash or kill.
// Runs before HTTP/SSE so a dead session cannot look still-busy or auto-replay.
import { integrityCheck, walCheckpoint } from "./db.ts";
import { recoverableJobs, updateJob } from "./jobs.ts";
import { forgetTurn, listPending } from "./pending.ts";
import type { Store } from "./store.ts";

const RECOVERY_ERROR = "previous session ended before this turn finished";

function appendRecoveryCard(store: Store, botId: string, jobId: string) {
  const bot = store.bot(botId);
  if (!bot) return;
  store.appendMessage(bot.threadId, {
    role: "bot",
    kind: "options",
    card: {
      title: "Turn interrupted",
      subtitle: "The previous NexBot session ended before this job finished.",
      options: ["Resume", "Retry"],
      requestId: `nexbot-job:${jobId}`,
    },
  });
}

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
  const settledBots = new Set<string>();
  for (const job of recoverableJobs().filter((j) => j.status === "running")) {
    updateJob(job.id, { status: "interrupted", error: RECOVERY_ERROR });
    forgetTurn(job.botId);
    const bot = store.bot(job.botId);
    if (!bot) continue;
    store.patchBot(bot.id, { busy: false });
    store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: RECOVERY_ERROR, ok: false },
    });
    appendRecoveryCard(store, bot.id, job.id);
    settledBots.add(bot.id);
    n += 1;
  }
  // Keep the old pending file as a migration fallback for turns created by an
  // older build before durable job rows existed.
  for (const p of pending) {
    forgetTurn(p.botId);
    if (settledBots.has(p.botId)) continue;
    const bot = store.bot(p.botId);
    if (!bot) continue;
    store.patchBot(bot.id, { busy: false });
    store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: RECOVERY_ERROR, ok: false },
    });
    n += 1;
  }
  return n;
}
