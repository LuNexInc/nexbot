import { describe, expect, it } from "vitest";
import { COS_PROMPT } from "./roles.ts";
import {
  isForbiddenEnvironCommand,
  isForbiddenEnvironPath,
  isForbiddenSecretAccess,
  scrubAgentChildEnv,
} from "./environ-guard.ts";

describe("isForbiddenEnvironPath", () => {
  it("denies linux proc environ paths", () => {
    expect(isForbiddenEnvironPath("/proc/123/environ")).toBe(true);
    expect(isForbiddenEnvironPath("/proc/self/environ")).toBe(true);
    expect(isForbiddenEnvironPath("/proc/1/task/1/environ")).toBe(true);
  });
  it("denies slash/backslash variants (WSL / Windows-style)", () => {
    expect(isForbiddenEnvironPath("\\\\proc\\\\self\\\\environ")).toBe(true);
    expect(isForbiddenEnvironPath("/PROC/SELF/ENVIRON")).toBe(true);
  });
  it("allows ordinary files", () => {
    expect(isForbiddenEnvironPath("/etc/hosts")).toBe(false);
    expect(isForbiddenEnvironPath("/home/box/notes.md")).toBe(false);
    expect(isForbiddenEnvironPath("C:\\\\Users\\\\Charles\\\\inbox\\\\todo.txt")).toBe(false);
  });
});

describe("isForbiddenEnvironCommand / isForbiddenSecretAccess", () => {
  it("denies a command whose path is a proc environ file", () => {
    expect(isForbiddenEnvironCommand("cat /proc/self/environ")).toBe(true);
    expect(isForbiddenSecretAccess({ command: "cat /proc/123/environ" })).toBe(true);
    expect(isForbiddenSecretAccess({ path: "/proc/self/environ" })).toBe(true);
    expect(isForbiddenSecretAccess({ raw: { path: "/proc/7/environ" } })).toBe(true);
  });
  it("allows a normal shell command", () => {
    expect(isForbiddenEnvironCommand("ls /home/box")).toBe(false);
    expect(isForbiddenSecretAccess({ command: "echo hi", path: "/tmp/out.txt" })).toBe(false);
  });
});

describe("COS_PROMPT secret ban", () => {
  it("contains the explicit environ / harness-secret bans", () => {
    expect(COS_PROMPT).toContain("/proc");
    expect(COS_PROMPT).toContain("environ");
    expect(COS_PROMPT).toContain("COMMS_TOKEN");
    expect(COS_PROMPT).toContain("x-nexbot-secret");
    expect(COS_PROMPT).toContain("scavenged tokens");
    expect(COS_PROMPT).toContain("After ask_bot returns");
  });
});

describe("scrubAgentChildEnv", () => {
  it("drops comms token keys without reading values", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      NEXBOT_COMMS_TOKEN: "redacted",
      COMMS_TOKEN: "redacted",
      NEXBOT_BOT_ID: "bot-1",
    };
    scrubAgentChildEnv(env);
    expect("NEXBOT_COMMS_TOKEN" in env).toBe(false);
    expect("COMMS_TOKEN" in env).toBe(false);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.NEXBOT_BOT_ID).toBe("bot-1");
  });
});
