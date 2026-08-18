import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { closeStoreDb } from "./db.ts";
import { createJob, getJob } from "./jobs.ts";
import { listPending, rememberTurn } from "./pending.ts";
import { sessionDeathSettlement } from "./recovery.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

beforeEach(() => {
  closeStoreDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
});
afterEach(() => { closeStoreDb(); });

describe("sessionDeathSettlement", () => {
  it("clears pending-turns orphans, unlocks busy, and records a failed activity", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Research" });
    store.patchBot(bot.id, { busy: true });
    rememberTurn(bot.id, "write the brief", "user");
    expect(listPending()).toHaveLength(1);
    const n = sessionDeathSettlement(store);
    expect(n).toBe(1);
    expect(listPending()).toHaveLength(0);
    expect(store.bot(bot.id)?.busy).toBe(false);
    const last = store.messagesFor(bot.threadId).at(-1);
    expect(last?.kind).toBe("activity");
    expect(last?.tool?.ok).toBe(false);
    expect(last?.tool?.name).toMatch(/previous session ended/i);
  });

  it("forgets pending rows even when the bot is gone", () => {
    rememberTurn("missing", "hello", "user");
    const store = new Store(selection);
    expect(sessionDeathSettlement(store)).toBe(0);
    expect(listPending()).toHaveLength(0);
  });

  it("settles a durable running job and exposes Resume and Retry actions", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Durable" });
    const message = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "finish the durable job" });
    const job = createJob({
      botId: bot.id,
      threadId: bot.threadId,
      messageId: message.id,
      text: "finish the durable job",
      source: "user",
      providerInstanceId: "claude",
      model: "claude-sonnet-5",
    });
    store.patchBot(bot.id, { busy: true });

    expect(sessionDeathSettlement(store)).toBe(1);
    expect(getJob(job.id)?.status).toBe("interrupted");
    const card = store.messagesFor(bot.threadId).at(-1);
    expect(card?.card?.options).toEqual(["Resume", "Retry"]);
    expect(card?.card?.requestId).toBe(`nexbot-job:${job.id}`);
  });
});

describe("Reflexion recovery", () => {
  it("builds the structured Reflexion verbal self-critique prompt", async () => {
    const { buildReflexionPrompt } = await import("./recovery.ts");
    const error = "previous session ended before this turn finished";
    const original = "Write a comprehensive report on autonomous systems.";
    const result = buildReflexionPrompt(error, original);

    expect(result).toBe(
      `[Reflexion Recovery - Previous failure context: "${error}"]\nDiagnose why the previous attempt failed and adjust your strategy to complete the original task:\n\n${original}`,
    );
  });

  it("extracts the clean original prompt across repeated retry / recovery turns", async () => {
    const { buildReflexionPrompt, extractOriginalPrompt } = await import("./recovery.ts");
    const original = "Deploy the container cluster";
    const firstAttempt = buildReflexionPrompt("network connection reset", original);
    const secondAttempt = buildReflexionPrompt("out of memory error", firstAttempt);

    expect(extractOriginalPrompt(firstAttempt)).toBe(original);
    expect(extractOriginalPrompt(secondAttempt)).toBe(original);
    expect(secondAttempt).toBe(
      `[Reflexion Recovery - Previous failure context: "out of memory error"]\nDiagnose why the previous attempt failed and adjust your strategy to complete the original task:\n\n${original}`,
    );
  });

  it("finds job failure context from job.error or store transcript history", async () => {
    const { findJobFailureContext, prepareReflexionPrompt } = await import("./recovery.ts");
    const store = new Store(selection);
    const bot = store.createBot({ name: "Worker" });

    const jobWithError = createJob({
      botId: bot.id,
      threadId: bot.threadId,
      messageId: "m1",
      text: "Analyze logs",
      source: "user",
      providerInstanceId: "codex",
      model: "gpt-5",
    });
    jobWithError.error = "rate limit 429";

    expect(findJobFailureContext(jobWithError, store)).toBe("rate limit 429");
    const preparedPrompt = prepareReflexionPrompt(jobWithError, store);
    expect(preparedPrompt).toContain('[Reflexion Recovery - Previous failure context: "rate limit 429"]');
    expect(preparedPrompt).toContain("Analyze logs");

    // When job has no error but thread has a failed activity tool message
    const cleanJob = createJob({
      botId: bot.id,
      threadId: bot.threadId,
      messageId: "m2",
      text: "Fix lint errors",
      source: "user",
      providerInstanceId: "codex",
      model: "gpt-5",
    });
    store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: "error: subprocess timed out", ok: false },
    });

    expect(findJobFailureContext(cleanJob, store)).toBe("error: subprocess timed out");
    const preparedFromThread = prepareReflexionPrompt(cleanJob, store);
    expect(preparedFromThread).toContain('[Reflexion Recovery - Previous failure context: "error: subprocess timed out"]');
    expect(preparedFromThread).toContain("Fix lint errors");
  });
});

