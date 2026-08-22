import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeStoreDb } from "./db.ts";
import { enqueueTurn, queuedTurns, takeNextTurn } from "./turn-queue.ts";

beforeEach(() => { closeStoreDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });

describe("user turn queue", () => {
  it("runs a steer message before normal queued work", () => {
    enqueueTurn({ botId: "b1", text: "later", messageId: "m1", delivery: "queue" });
    enqueueTurn({ botId: "b1", text: "next", messageId: "m2", delivery: "steer" });
    expect(queuedTurns("b1").map((row) => row.text)).toEqual(["next", "later"]);
    expect(takeNextTurn("b1")?.text).toBe("next");
  });
});
