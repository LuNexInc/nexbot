// Settle in-flight turns left in pending-turns.json after a crash or kill.
// Runs before HTTP/SSE so a dead session cannot look still-busy or auto-replay.
import { integrityCheck, walCheckpoint } from "./db.ts";
import { recoverableJobs, updateJob, type DurableJob } from "./jobs.ts";
import { forgetTurn, listPending } from "./pending.ts";
import type { Store } from "./store.ts";

export const RECOVERY_ERROR = "previous session ended before this turn finished";

const REFLEXION_PREFIX_RE = /^\[Reflexion Recovery - Previous failure context: "(?:[^"\\]|\\.)*"\]\s*Diagnose why the previous attempt failed and adjust your strategy to complete the original task:\s*/s;

/** Strip any prior Reflexion recovery envelope so multiple retries stay clean. */
export function extractOriginalPrompt(text: string): string {
  let current = text;
  while (REFLEXION_PREFIX_RE.test(current)) {
    current = current.replace(REFLEXION_PREFIX_RE, "");
  }
  return current;
}

/** Construct a structured Reflexion verbal self-critique prompt. */
export function buildReflexionPrompt(error: string, originalPrompt: string): string {
  const cleanPrompt = extractOriginalPrompt(originalPrompt);
  const cleanError = error.trim().replace(/"/g, '\\"');
  return `[Reflexion Recovery - Previous failure context: "${cleanError}"]\nDiagnose why the previous attempt failed and adjust your strategy to complete the original task:\n\n${cleanPrompt}`;
}

/** Extract previous failure context from the job error field or thread history. */
export function findJobFailureContext(job: DurableJob, store?: Store): string | undefined {
  if (job.error && job.error.trim()) {
    return job.error.trim();
  }
  if (store) {
    const threadId = job.threadId;
    const messages = store.messagesFor(threadId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.kind === "activity" && msg.tool?.ok === false && msg.tool.name) {
        return msg.tool.name.trim();
      }
      if (msg.status === "failed") {
        return "previous turn delivery failed";
      }
    }
  }
  if (job.status === "interrupted") {
    return "previous turn was interrupted";
  }
  if (job.status === "failed") {
    return "previous turn failed";
  }
  return undefined;
}

/** Prepare the turn prompt with a Reflexion envelope if failure context exists. */
export function prepareReflexionPrompt(job: DurableJob, store?: Store): string {
  const failureContext = findJobFailureContext(job, store);
  if (failureContext) {
    return buildReflexionPrompt(failureContext, job.text);
  }
  return job.text;
}

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

