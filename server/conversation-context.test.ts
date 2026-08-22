import { describe, expect, it } from "vitest";
import { compactToolOutput } from "./conversation-context.ts";

describe("conversation-context", () => {
  it("compactToolOutput passes through small strings", () => {
    const text = "short tool result";
    expect(compactToolOutput(text, 100)).toBe(text);
  });

  it("compactToolOutput prunes large payload with head and tail retained", () => {
    const large = "A".repeat(500) + "MIDDLE_DATA" + "Z".repeat(500);
    const compacted = compactToolOutput(large, 200);
    expect(compacted.length).toBeLessThan(large.length);
    expect(compacted).toContain("characters omitted for prompt compactness");
    expect(compacted.startsWith("A")).toBe(true);
    expect(compacted.endsWith("Z")).toBe(true);
  });
});
