import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { closeStoreDb } from "./db.ts";
import { completeReceipt, listReceipts, observeFrame, startReceipt } from "./execution-evidence.ts";

beforeEach(() => {
  closeStoreDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
});
describe("execution evidence", () => {
  it("marks a computer receipt changed only after a different post-action frame", () => {
    observeFrame("bot-a", "frame-before");
    const receipt = startReceipt({ botId: "bot-a", threadId: "thread-a", jobId: "job-a", action: "computer.click", visual: true });
    expect(receipt.beforeHash).toBeTruthy();
    expect(completeReceipt(receipt.id, true)?.verification).toBe("pending");
    expect(observeFrame("bot-a", "frame-after")[0]?.verification).toBe("changed");
    expect(listReceipts({ jobId: "job-a" })[0]).toMatchObject({ status: "succeeded", verification: "changed" });
  });

  it("reports an unchanged frame without claiming success", () => {
    observeFrame("bot-b", "same-frame");
    const receipt = startReceipt({ botId: "bot-b", threadId: "thread-b", action: "computer.click", visual: true });
    completeReceipt(receipt.id, true);
    expect(observeFrame("bot-b", "same-frame")[0]?.verification).toBe("unchanged");
  });
});
