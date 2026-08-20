import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeStoreDb } from "./db.ts";
import { listMemoryFacts, saveMemoryFact, searchMemoryFacts } from "./memory-facts.ts";

beforeEach(() => { closeStoreDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });

describe("provenance-bound memory", () => {
  it("keeps source metadata and excludes expired facts", () => {
    const now = Date.now();
    saveMemoryFact({ botId: "b1", fact: "The launch color is cobalt", kind: "fact", sourceType: "user", sourceId: "message-1", sourceAt: now - 100, confidence: 1 });
    saveMemoryFact({ botId: "b1", fact: "The old launch color was amber", kind: "fact", sourceType: "import", sourceId: "old-note", sourceAt: now - 1_000, validUntil: now - 1, confidence: 0.7 });
    expect(listMemoryFacts("b1", now)).toHaveLength(1);
    expect(searchMemoryFacts("cobalt", { botId: "b1", now })[0]).toMatchObject({ sourceId: "message-1", confidence: 1 });
    expect(searchMemoryFacts("amber", { botId: "b1", now })).toEqual([]);
  });
});
