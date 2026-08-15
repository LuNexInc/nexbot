import { describe, expect, it } from "vitest";

import { chooseAntigravityCosSelection, pickDefaultSelection, type DescribedInstance } from "./selection.ts";

function d(
  partial: Partial<DescribedInstance> & Pick<DescribedInstance, "instanceId" | "driverKind">,
): DescribedInstance {
  return {
    snapshot: { state: "available" },
    models: { default: `${partial.driverKind}-default` },
    ...partial,
  };
}

describe("pickDefaultSelection", () => {
  it("prefers grokAgent over grok, codex, and claude", () => {
    const pick = pickDefaultSelection([
      d({ instanceId: "claude", driverKind: "claudeAgent" }),
      d({ instanceId: "codex", driverKind: "codex" }),
      d({ instanceId: "grok", driverKind: "grokAgent" }),
    ]);
    expect(pick).toEqual({ instanceId: "grok", model: "grokAgent-default" });
  });

  it("prefers grok when grokAgent is missing", () => {
    const pick = pickDefaultSelection([
      d({ instanceId: "claude", driverKind: "claudeAgent" }),
      d({ instanceId: "codex", driverKind: "codex" }),
      d({ instanceId: "grok", driverKind: "grok" }),
    ]);
    expect(pick).toEqual({ instanceId: "grok", model: "grok-default" });
  });

  it("prefers codex when no grok driver is available", () => {
    const pick = pickDefaultSelection([
      d({ instanceId: "claude", driverKind: "claudeAgent" }),
      d({ instanceId: "codex", driverKind: "codex" }),
    ]);
    expect(pick).toEqual({ instanceId: "codex", model: "codex-default" });
  });

  it("skips claude when another authenticated driver is available", () => {
    const pick = pickDefaultSelection([
      d({ instanceId: "claude", driverKind: "claudeAgent" }),
      d({ instanceId: "gemini", driverKind: "geminiAgent" }),
    ]);
    expect(pick.instanceId).toBe("gemini");
  });

  it("picks claude only when it is the sole available authenticated driver", () => {
    const pick = pickDefaultSelection([
      d({ instanceId: "claude", driverKind: "claudeAgent" }),
      d({
        instanceId: "grok",
        driverKind: "grokAgent",
        snapshot: { state: "unavailable" },
      }),
    ]);
    expect(pick).toEqual({ instanceId: "claude", model: "claudeAgent-default" });
  });

  it("skips unauthenticated grok and falls through", () => {
    const pick = pickDefaultSelection([
      d({
        instanceId: "grok",
        driverKind: "grokAgent",
        snapshot: { state: "available", authenticated: false },
      }),
      d({ instanceId: "codex", driverKind: "codex" }),
    ]);
    expect(pick.instanceId).toBe("codex");
  });

  it("falls back to grok / grok-4.5 when nothing is described", () => {
    expect(pickDefaultSelection([])).toEqual({ instanceId: "grok", model: "grok-4.5" });
  });

  it("falls back to the first described instance when none are available", () => {
    const pick = pickDefaultSelection([
      d({
        instanceId: "claude",
        driverKind: "claudeAgent",
        snapshot: { state: "unavailable" },
        models: { default: "sonnet" },
      }),
    ]);
    expect(pick).toEqual({ instanceId: "claude", model: "sonnet" });
  });
});

describe("chooseAntigravityCosSelection", () => {
  it("leaves non-antigravity selections untouched", () => {
    const pick = chooseAntigravityCosSelection({ instanceId: "codex", model: "gpt-5.5" }, "hello");
    expect(pick).toEqual({ instanceId: "codex", model: "gpt-5.5" });
  });

  it("keeps standard Antigravity CoS turns on Gemini 3.7 Flash Medium/Low", () => {
    const pick = chooseAntigravityCosSelection({ instanceId: "antigravity", model: "gemini-3.7-flash-medium" }, "check my inbox");
    expect(pick).toEqual({ instanceId: "antigravity", model: "gemini-3.7-flash-medium" });
  });

  it("locks non-3.7 Antigravity models onto Gemini 3.7 Flash for Chief of Staff", () => {
    const pick = chooseAntigravityCosSelection({ instanceId: "antigravity", model: "gemini-3.1-pro-high" }, "routine turn");
    expect(pick.model).toBe("gemini-3.7-flash-high");
  });

  it("promotes normal turns to Gemini 3.7 Flash High for complex multi-step requests", () => {
    const complexPrompt = "Please analyze, review, and evaluate the full architecture across multiple deliverables step by step.";
    const pick = chooseAntigravityCosSelection({ instanceId: "antigravity", model: "gemini-3.7-flash-medium" }, complexPrompt);
    expect(pick).toEqual({ instanceId: "antigravity", model: "gemini-3.7-flash-high", reasoningEffort: "high" });
  });

  it("preserves explicit reasoningEffort overrides on Gemini 3.7 Flash", () => {
    const pick = chooseAntigravityCosSelection({ instanceId: "antigravity", model: "gemini-3.7-flash-low", reasoningEffort: "low" }, "analyze deeply");
    expect(pick).toEqual({ instanceId: "antigravity", model: "gemini-3.7-flash-low", reasoningEffort: "low" });
  });
});
