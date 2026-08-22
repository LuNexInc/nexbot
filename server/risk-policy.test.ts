import { describe, expect, it } from "vitest";
import { classifyPermission, applyPermissionMode, type RiskLevel } from "./risk-policy.ts";

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
  // NexBot's own internal coordination tools → allow (no external effect)
  { tool: "other", summary: "agents__list_bots", level: "low", action: "allow" },
  { tool: "other", summary: "agents__search_history", level: "low", action: "allow" },
  { tool: "other", summary: "agents__send_bot", level: "low", action: "allow" },
  { tool: "other", summary: "agents__save_memory", level: "low", action: "allow" },
  { tool: "other", summary: "todos__todo", level: "low", action: "allow" },
  // read-only web fetch → allow
  { tool: "fetch", summary: "Fetch: https://example.com/article", level: "low", action: "allow" },
  // benign PowerShell formatting (the "-Format" switch) is NOT critical
  { tool: "shell", summary: 'Get-Date -Format "yyyy-MM-dd HH:mm"', level: "medium", action: "allow" },
  { tool: "shell", summary: "Get-Content -Path .\\notes.txt", level: "medium", action: "allow" },
  // a real disk format is still critical
  { tool: "shell", summary: "format volume", level: "critical", action: "ask" },
  { tool: "shell", summary: "format C:", level: "critical", action: "ask" },
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

describe("applyPermissionMode", () => {
  const read = classifyPermission("read_file", "read README.md");
  const write = classifyPermission("edit", "write notes.md");
  const destructive = classifyPermission("shell", "delete the build folder");
  const critical = classifyPermission("shell", "transfer money to the vendor");
  const unknown = classifyPermission("tool", "unknown action");

  it("readonly auto-allows only read-only actions", () => {
    expect(applyPermissionMode(read, "readonly").action).toBe("allow");
    expect(applyPermissionMode(write, "readonly").action).toBe("ask");
    expect(applyPermissionMode(destructive, "readonly").action).toBe("ask");
    expect(applyPermissionMode(critical, "readonly").action).toBe("ask");
    expect(applyPermissionMode(unknown, "readonly").action).toBe("ask");
  });

  it("workspace leaves the base classification untouched", () => {
    expect(applyPermissionMode(read, "workspace").action).toBe("allow");
    expect(applyPermissionMode(write, "workspace").action).toBe("allow");
    expect(applyPermissionMode(destructive, "workspace").action).toBe("ask");
    expect(applyPermissionMode(critical, "workspace").action).toBe("ask");
    expect(applyPermissionMode(unknown, "workspace").action).toBe("ask");
  });

  it("full auto-allows destructive but still gates critical unless allowed", () => {
    expect(applyPermissionMode(read, "full").action).toBe("allow");
    expect(applyPermissionMode(write, "full").action).toBe("allow");
    expect(applyPermissionMode(destructive, "full").action).toBe("allow");
    expect(applyPermissionMode(critical, "full").action).toBe("ask");
    expect(applyPermissionMode(critical, "full", true).action).toBe("allow");
    expect(applyPermissionMode(unknown, "full").action).toBe("ask");
  });
});
