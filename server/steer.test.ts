import { rmSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";

import { DATA_DIR } from "./config.ts";
import { checkSteerToken, loadSteerToken, rotateSteerToken, tokenFromRequest } from "./steer.ts";

describe("steer token", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("creates a token and checks it in constant time", () => {
    const a = loadSteerToken();
    expect(a.length).toBeGreaterThan(20);
    expect(checkSteerToken(a)).toBe(true);
    expect(checkSteerToken("nope")).toBe(false);
    expect(checkSteerToken("")).toBe(false);
    const b = rotateSteerToken();
    expect(b).not.toBe(a);
    expect(checkSteerToken(a)).toBe(false);
    expect(checkSteerToken(b)).toBe(true);
  });

  it("reads Bearer or query", () => {
    expect(tokenFromRequest("Bearer abc", null)).toBe("abc");
    expect(tokenFromRequest(undefined, "q")).toBe("q");
  });
});
