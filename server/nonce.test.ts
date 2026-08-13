import { describe, expect, it } from "vitest";
import { createNonceCache } from "./nonce.ts";

describe("nonce cache", () => {
  it("accepts a first bot+nonce and drops a duplicate within TTL", () => {
    const cache = createNonceCache(60_000);
    const t0 = 1_000_000;
    expect(cache.isDuplicate("bot-a", "n1", t0)).toBe(false);
    cache.record("bot-a", "n1", t0);
    expect(cache.isDuplicate("bot-a", "n1", t0 + 1_000)).toBe(true);
  });

  it("does not treat the same nonce on a different bot as a duplicate", () => {
    const cache = createNonceCache(60_000);
    const t0 = 1_000_000;
    cache.record("bot-a", "n1", t0);
    expect(cache.isDuplicate("bot-b", "n1", t0 + 1)).toBe(false);
  });

  it("expires after TTL so a later retry is accepted", () => {
    const cache = createNonceCache(60_000);
    const t0 = 1_000_000;
    cache.record("bot-a", "n1", t0);
    expect(cache.isDuplicate("bot-a", "n1", t0 + 60_001)).toBe(false);
  });

  it("ignores empty nonces", () => {
    const cache = createNonceCache(60_000);
    expect(cache.isDuplicate("bot-a", undefined)).toBe(false);
    expect(cache.isDuplicate("bot-a", "")).toBe(false);
    cache.record("bot-a", undefined);
    cache.record("bot-a", "");
    expect(cache.isDuplicate("bot-a", undefined)).toBe(false);
  });

  it("forget lets a failed submit retry the same nonce", () => {
    const cache = createNonceCache(60_000);
    const t0 = 1_000_000;
    cache.record("bot-a", "n1", t0);
    cache.forget("bot-a", "n1");
    expect(cache.isDuplicate("bot-a", "n1", t0 + 10)).toBe(false);
  });
});
