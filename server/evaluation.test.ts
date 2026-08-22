import { describe, expect, it } from "vitest";
import { passAtK, scoreAttempts } from "./evaluation.ts";

describe("benchmark scoring", () => {
  it("calculates pass@k and per-case summaries", () => {
    expect(passAtK(3, 1, 1)).toBeCloseTo(1 / 3);
    expect(passAtK(3, 1, 3)).toBe(1);
    const scores = scoreAttempts([
      { caseId: "a", ok: true, durationMs: 10, successfulTools: 1, verifiedStateChanges: 0, requiredTextMatched: true },
      { caseId: "a", ok: false, durationMs: 20, successfulTools: 0, verifiedStateChanges: 0, requiredTextMatched: false },
    ]);
    expect(scores[0]).toMatchObject({ caseId: "a", attempts: 2, passed: 1, passRate: 0.5, medianDurationMs: 20 });
  });
});
