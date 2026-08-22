import { describe, expect, it } from "vitest";
import {
  claimFeedbackPrompt,
  clearClaimFeedback,
  setClaimFeedback,
  takeClaimFeedback,
} from "./claim-feedback.ts";

describe("claim feedback", () => {
  it("returns null when nothing is pending", () => {
    expect(takeClaimFeedback("bot-a")).toBeNull();
  });

  it("round-trips a note and consumes it on read", () => {
    setClaimFeedback("bot-a", "1 computer action reported no state change.");
    expect(takeClaimFeedback("bot-a")).toContain("no state change");
    expect(takeClaimFeedback("bot-a")).toBeNull();
  });

  it("keeps only the latest note per bot", () => {
    setClaimFeedback("bot-a", "first");
    setClaimFeedback("bot-a", "second");
    expect(takeClaimFeedback("bot-a")).toBe("second");
  });

  it("caps a very long note", () => {
    setClaimFeedback("bot-a", "x".repeat(5000));
    expect(takeClaimFeedback("bot-a")!.length).toBeLessThanOrEqual(400);
  });

  it("ignores an empty note", () => {
    setClaimFeedback("bot-a", "   ");
    expect(takeClaimFeedback("bot-a")).toBeNull();
  });

  it("builds an instructional prompt", () => {
    const p = claimFeedbackPrompt("an action failed");
    expect(p).toContain("an action failed");
    expect(p).toContain("before you claim it");
  });

  it("clear removes a pending note", () => {
    setClaimFeedback("bot-a", "note");
    clearClaimFeedback("bot-a");
    expect(takeClaimFeedback("bot-a")).toBeNull();
  });
});
