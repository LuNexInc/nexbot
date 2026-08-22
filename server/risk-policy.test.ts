import { describe, expect, it } from "vitest";
import { classifyPermission } from "./risk-policy.ts";

describe("risk policy", () => {
  it("allows read-only requests", () => {
    expect(classifyPermission("read_file", "read README.md")).toMatchObject({ level: "low", action: "allow" });
  });

  it("asks before durable, external, or credential actions", () => {
    expect(classifyPermission("shell", "git push origin main").action).toBe("ask");
    expect(classifyPermission("browser", "send email to the customer").level).toBe("critical");
    expect(classifyPermission("tool", "unknown action").action).toBe("ask");
  });
});
