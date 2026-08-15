import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmSync } from "node:fs";

import { DATA_DIR } from "./config.ts";
import { closeStoreDb, importJsonIfNeeded, openStoreDb } from "./db.ts";
import { sweepLegacyDataFiles } from "./data-hygiene.ts";

beforeEach(() => {
  closeStoreDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});
afterEach(() => {
  closeStoreDb();
});

describe("data-hygiene", () => {
  it("removes the unused data.sqlite file", () => {
    writeFileSync(join(DATA_DIR, "data.sqlite"), "");
    const removed = sweepLegacyDataFiles();
    expect(removed).toContain("data.sqlite");
    expect(existsSync(join(DATA_DIR, "data.sqlite"))).toBe(false);
  });

  it("does not delete messages-*.json before the SQLite import finishes", () => {
    writeFileSync(join(DATA_DIR, "messages-t1.json"), JSON.stringify([{ id: "m1", role: "user", kind: "text", text: "keep", at: 1 }]));
    const removed = sweepLegacyDataFiles();
    expect(removed.some((name) => name.startsWith("messages-"))).toBe(false);
    expect(existsSync(join(DATA_DIR, "messages-t1.json"))).toBe(true);
  });

  it("deletes leftover message JSON after import", () => {
    const bot = {
      id: "b1",
      threadId: "t1",
      name: "Research",
      title: "Research",
      description: "",
      notifications: true,
      color: "blue",
      unread: false,
      modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
      resumeCursors: {},
      createdAt: 1,
    };
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify([bot]));
    writeFileSync(
      join(DATA_DIR, "messages-t1.json"),
      JSON.stringify([{ id: "m1", role: "user", kind: "text", text: "find cafe sources", at: 2 }]),
    );
    expect(importJsonIfNeeded().messages).toBe(1);
    openStoreDb();
    const removed = sweepLegacyDataFiles();
    expect(removed).toContain("messages-t1.json");
    expect(existsSync(join(DATA_DIR, "messages-t1.json"))).toBe(false);
  });
});
