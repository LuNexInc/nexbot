import { describe, expect, it } from "vitest";
import { assessClaimEvidence, shortCaveat } from "./claim-evidence.ts";
import type { ExecutionReceipt } from "./execution-evidence.ts";

function receipt(overrides: Partial<ExecutionReceipt>): ExecutionReceipt {
  return {
    id: `receipt-${Math.random().toString(36).slice(2, 8)}`,
    botId: "bot-a",
    threadId: "thread-a",
    action: "tool",
    status: "succeeded",
    verification: "not_requested",
    evidenceType: "provider_completion",
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("assessClaimEvidence", () => {
  it("returns null when there are no receipts", () => {
    expect(assessClaimEvidence([])).toBeNull();
  });

  it("returns null for a clean read/successful turn with nothing state-changing", () => {
    const result = assessClaimEvidence([
      receipt({ action: "read_file", status: "succeeded", verification: "not_requested", evidenceType: "provider_completion" }),
      receipt({ action: "grep", status: "succeeded", verification: "not_requested", evidenceType: "provider_completion" }),
    ]);
    expect(result).toBeNull();
  });

  it("returns null when every visual state change verified", () => {
    const result = assessClaimEvidence([
      receipt({ action: "click", status: "succeeded", verification: "changed", evidenceType: "visual_state_change" }),
    ]);
    expect(result).toBeNull();
  });

  it("flags unverified when a computer action reported no state change", () => {
    const result = assessClaimEvidence([
      receipt({ action: "click_save", status: "succeeded", verification: "unchanged", evidenceType: "visual_state_change" }),
    ]);
    expect(result?.verdict).toBe("unverified");
    expect(result?.unchanged).toBe(1);
  });

  it("flags unverified when an action failed", () => {
    const result = assessClaimEvidence([
      receipt({ action: "write_file", status: "failed", verification: "not_requested", evidenceType: "provider_completion" }),
    ]);
    expect(result?.verdict).toBe("unverified");
    expect(result?.failed).toBe(1);
  });

  it("flags unverified when an action was blocked", () => {
    const result = assessClaimEvidence([
      receipt({ action: "deploy", status: "blocked", verification: "not_requested", evidenceType: "provider_completion" }),
    ]);
    expect(result?.verdict).toBe("unverified");
    expect(result?.blocked).toBe(1);
  });

  it("reports partially verified when a computer action could not be confirmed", () => {
    const result = assessClaimEvidence([
      receipt({ action: "click", status: "succeeded", verification: "pending", evidenceType: "visual_state_change" }),
    ]);
    expect(result?.verdict).toBe("partially_verified");
  });

  it("surfaces a clear note on the caveat", () => {
    const result = assessClaimEvidence([
      receipt({ action: "click_save", status: "succeeded", verification: "unchanged", evidenceType: "visual_state_change" }),
    ]);
    expect(result?.note).toContain("no state change");
    expect(result?.note).toContain("could not verify");
  });
});

describe("shortCaveat", () => {
  it("keeps a short note as-is", () => {
    expect(shortCaveat("1 action failed")).toBe("1 action failed");
  });

  it("drops the long 'could not verify' tail", () => {
    const full = "1 computer action(s) reported no state change. NexBot could not verify that the claimed work actually happened, so treat the result as unconfirmed.";
    expect(shortCaveat(full)).toBe("1 computer action(s) reported no state change");
  });

  it("returns empty for an empty note", () => {
    expect(shortCaveat("")).toBe("");
  });
});
