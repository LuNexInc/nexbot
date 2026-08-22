// CLI version drift detection. NexBot drives external agent CLIs by protocol
// (ACP / print mode), so a CLI major bump can silently change behavior or
// break a driver. Each driver records the version it was last validated
// against; this module compares the live `--version` snapshot to that baseline
// and reports drift so it is caught before it bites.
const SEMVER = /(\d+(?:\.\d+){1,3})/;

/** Last-validated version per driver kind. Seed with the versions observed
 * to be working; bump the entry when you re-validate a driver against a new
 * CLI version. A missing entry means "no baseline" (no drift warning until
 * one is set). */
export const KNOWN_GOOD: Record<string, string> = {
  antigravity: "1.1.18",
  codex: "0.147.0",
  claude: "2.1.229",
  grokAgent: "1.0.5",
};

/** Extract the semantic version token from a CLI `--version` string, which
 * drivers keep as the raw trimmed stdout (e.g. "codex-cli 0.147.0").
 * Returns null when no semver is present. */
export function normalizeVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const match = SEMVER.exec(version);
  return match ? match[1] : null;
}

export interface CliDrift {
  /** Normalized version actually installed. */
  version: string | null;
  /** Baseline version recorded for this driver, or null if unset. */
  expected: string | null;
  /** True when a baseline exists and the installed version differs. */
  drifted: boolean;
}

/** Compare an instance's live CLI version against its driver's baseline. */
export function cliDrift(driverKind: string, version: string | null | undefined): CliDrift {
  const actual = normalizeVersion(version);
  const expected = KNOWN_GOOD[driverKind] ?? null;
  return { version: actual, expected, drifted: Boolean(expected && actual && actual !== expected) };
}
