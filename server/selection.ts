// Pure default model pick. Grok-first, then Codex; Claude only if it is
// the sole available authenticated driver. Kept out of index.ts so the
// preference order can be unit-tested without booting the harness.
import type { ModelSelection, ProviderSnapshot } from "./contracts.ts";

export type DescribedInstance = {
  instanceId: string;
  driverKind: string;
  snapshot: ProviderSnapshot;
  models: { default: string };
};

export function pickDefaultSelection(described: DescribedInstance[]): ModelSelection {
  const available = described.filter(
    (d) => d.snapshot.state === "available" && d.snapshot.authenticated !== false,
  );
  const prefer = (kind: string) => available.find((d) => d.driverKind === kind || d.instanceId === kind);
  const pick =
    prefer("grokAgent") ??
    prefer("grok") ??
    prefer("codex") ??
    available.find((d) => d.driverKind !== "claudeAgent" && d.instanceId !== "claude") ??
    available[0] ??
    described[0];
  return { instanceId: pick?.instanceId ?? "grok", model: pick?.models.default || "grok-4.5" };
}

const COMPLEX_COS_WORDS = /\b(analyze|architect|breakdown|compare|decision|evaluate|investigate|plan|prioritize|review|strategy|tradeoff|versus|vs\.?)\b/gi;

export function isComplexCosRequest(text: string): boolean {
  const matches = text.match(COMPLEX_COS_WORDS)?.length ?? 0;
  return text.trim().length >= 900 || matches >= 2 || /\b(step[- ]by[- ]step|multiple deliverables|full review)\b/i.test(text);
}

export function chooseAntigravityCosSelection(selection: ModelSelection, text: string): ModelSelection {
  if (selection.instanceId !== "antigravity") return selection;
  const isExplicitEffort = selection.reasoningEffort && selection.reasoningEffort !== "auto";
  const match = /^(gemini-[\d.]+-flash)(?:-(low|medium|high))?$/.exec(selection.model);
  const baseModel = "gemini-3.7-flash";
  const level = match ? (match[2] ?? "medium") : (selection.model.includes("high") ? "high" : selection.model.includes("low") ? "low" : "medium");

  if (isExplicitEffort) {
    const effort = selection.reasoningEffort!;
    return { ...selection, model: `${baseModel}-${effort}`, reasoningEffort: effort };
  }
  if (level === "high") return { ...selection, model: `${baseModel}-high` };
  if (!isComplexCosRequest(text)) return { ...selection, model: `${baseModel}-${level}` };
  return { ...selection, model: `${baseModel}-high`, reasoningEffort: "high" };
}
