import { describe, expect, it } from "vitest";
import { headerSecret, portBusyHint, repoMatches, secretsMatch } from "./http-util.ts";
import type { IncomingMessage } from "node:http";

describe("portBusyHint", () => {
  it("tells the operator to quit the installed tray app", () => {
    const msg = portBusyHint(8799);
    expect(msg).toContain("EADDRINUSE");
    expect(msg).toContain("8799");
    expect(msg).toContain("tray");
    expect(msg).toMatch(/Quit/);
    expect(msg).toContain("5199");
    expect(msg).toContain("UI only");
  });
});

describe("webhook helpers", () => {
  it("reads x-nexbot-secret from a single header value", () => {
    const req = { headers: { "x-nexbot-secret": "abc" } } as unknown as IncomingMessage;
    expect(headerSecret(req)).toBe("abc");
  });

  it("matches secrets only when both buffers have the same length", () => {
    expect(secretsMatch("token-a", "token-a")).toBe(true);
    expect(secretsMatch("token-a", "token-b")).toBe(false);
    expect(secretsMatch("short", "longer")).toBe(false);
  });

  it("matches a GitHub repo filter against the payload name", () => {
    expect(repoMatches("LuNexInc/nexbot", { repository: { full_name: "lunexinc/nexbot" } })).toBe(true);
    expect(repoMatches("LuNexInc/nexbot", { repository: { full_name: "other/repo" } })).toBe(false);
    expect(repoMatches("LuNexInc/nexbot", null)).toBe(false);
  });
});
