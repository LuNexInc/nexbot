import { describe, expect, it } from "vitest";
import { classifyPermission, type RiskLevel } from "./risk-policy.ts";

// The full classification table. This gate stands between an agent and
// destructive actions, so every branch is pinned: an auto-allow regression
// here is a security regression.
const TABLE: Array<{ tool: string; summary: string; level: RiskLevel; action: "allow" | "ask" }> = [
  // read-only → allow
  { tool: "read_file", summary: "read README.md", level: "low", action: "allow" },
  { tool: "search", summary: "search the desk for invoices", level: "low", action: "allow" },
  { tool: "view", summary: "list files in the folder", level: "low", action: "allow" },
  { tool: "screenshot", summary: "screenshot the active window", level: "low", action: "allow" },
  // reversible local work → allow
  { tool: "write_file", summary: "write notes.md", level: "medium", action: "allow" },
  { tool: "edit", summary: "edit src/index.ts", level: "medium", action: "allow" },
  { tool: "patch", summary: "patch the config file", level: "medium", action: "allow" },
  { tool: "shell", summary: "create a build directory", level: "medium", action: "allow" },
  // durable or destructive → ask
  { tool: "shell", summary: "delete the build folder", level: "high", action: "ask" },
  { tool: "shell", summary: "rm -rf node_modules", level: "high", action: "ask" },
  { tool: "shell", summary: "install the dependency", level: "high", action: "ask" },
  { tool: "git", summary: "git push origin main", level: "high", action: "ask" },
  { tool: "git", summary: "git commit the staged files", level: "medium", action: "allow" },
  // critical: credentials, money, publishing, other people → ask
  { tool: "browser", summary: "send email to the customer", level: "critical", action: "ask" },
  { tool: "browser", summary: "post publicly on the account", level: "critical", action: "ask" },
  { tool: "shell", summary: "format the drive", level: "critical", action: "ask" },
  { tool: "shell", summary: "transfer money to the vendor", level: "critical", action: "ask" },
  { tool: "vault", summary: "rotate key", level: "critical", action: "ask" },
  { tool: "vault", summary: "read the stored password", level: "critical", action: "ask" },
  // unknown → ask, never silently allow
  { tool: "tool", summary: "unknown action", level: "high", action: "ask" },
];

describe("risk policy", () => {
  it.each(TABLE)("classifies $tool: $summary → $level/$action", ({ tool, summary, level, action }) => {
    expect(classifyPermission(tool, summary)).toMatchObject({ level, action });
  });

  it("asks before durable, external, or credential actions", () => {
    expect(classifyPermission("shell", "git push origin main").action).toBe("ask");
    expect(classifyPermission("browser", "send email to the customer").level).toBe("critical");
    expect(classifyPermission("tool", "unknown action").action).toBe("ask");
  });
});
