import { describe, expect, it } from "vitest";
import { armVerify, clearVerify, isVerifyPending, takeVerify, verifyPrompt } from "./verify-request.ts";

describe("verify request", () => {
  it("arms and takes a verify once", () => {
    expect(armVerify("bot-a", "an action failed")).toBe(true);
    expect(isVerifyPending("bot-a")).toBe(true);
    expect(takeVerify("bot-a")).toContain("an action failed");
    expect(isVerifyPending("bot-a")).toBe(false);
    expect(takeVerify("bot-a")).toBeNull();
  });

  it("does not double-arm while one is pending", () => {
    expect(armVerify("bot-b", "first")).toBe(true);
    expect(armVerify("bot-b", "second")).toBe(false);
  });

  it("rejects an empty caveat", () => {
    expect(armVerify("bot-c", "   ")).toBe(false);
    expect(isVerifyPending("bot-c")).toBe(false);
  });

  it("clear removes a pending verify", () => {
    armVerify("bot-d", "note");
    clearVerify("bot-d");
    expect(takeVerify("bot-d")).toBeNull();
  });

  it("builds a verify-only, no-new-work prompt", () => {
    const p = verifyPrompt("1 action failed");
    expect(p).toContain("do NOT start new work");
    expect(p).toContain("verify what you claimed");
    expect(p).toContain("1 action failed");
  });
});
