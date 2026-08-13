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
