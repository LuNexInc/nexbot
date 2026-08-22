import { describe, expect, it } from "vitest";
import { normalizeVersion, cliDrift } from "./cli-version.ts";

describe("normalizeVersion", () => {
  it.each([
    ["1.1.18", "1.1.18"],
    ["codex-cli 0.147.0", "0.147.0"],
    ["2.1.229 (Claude Code)", "2.1.229"],
    ["grok 1.0.5 (5115b46bc9) [alpha]", "1.0.5"],
  ])("extracts the semver token from %s -> %s", (raw, expected) => {
    expect(normalizeVersion(raw)).toBe(expected);
  });

  it("returns null for empty or non-semver input", () => {
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("not a version")).toBeNull();
  });
});

describe("cliDrift", () => {
  it("matches the baseline (no drift)", () => {
    expect(cliDrift("antigravity", "1.1.18")).toMatchObject({ version: "1.1.18", expected: "1.1.18", drifted: false });
    expect(cliDrift("codex", "codex-cli 0.147.0")).toMatchObject({ version: "0.147.0", expected: "0.147.0", drifted: false });
  });

  it("flags drift when the installed version differs", () => {
    expect(cliDrift("antigravity", "1.2.0").drifted).toBe(true);
    expect(cliDrift("codex", "codex-cli 0.149.0").drifted).toBe(true);
    expect(cliDrift("claude", "3.0.0").drifted).toBe(true);
  });

  it("reports no baseline for an unknown driver (never warns)", () => {
    expect(cliDrift("some-other-driver", "1.0.0")).toEqual({ version: "1.0.0", expected: null, drifted: false });
  });

  it("does not drift when no version could be read", () => {
    expect(cliDrift("antigravity", null)).toMatchObject({ version: null, expected: "1.1.18", drifted: false });
  });
});
