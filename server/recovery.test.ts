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
