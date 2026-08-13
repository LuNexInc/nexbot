import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { closeStoreDb } from "./db.ts";
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
});
