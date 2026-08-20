import { describe, expect, it } from "vitest";
import { pickerInstances } from "./provider-visibility";

describe("provider picker visibility", () => {
  it("hides the stale Gemini CLI while keeping current providers", () => {
    const instances = [
      { instanceId: "grok", driverKind: "grokAgent" },
      { instanceId: "gemini", driverKind: "geminiAgent" },
      { instanceId: "antigravity", driverKind: "antigravity" },
    ] as any;
    expect(pickerInstances(instances).map((instance) => instance.instanceId)).toEqual(["grok", "antigravity"]);
  });
});
