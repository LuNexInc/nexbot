export interface BenchmarkAttempt {
  caseId: string;
  ok: boolean;
  durationMs: number;
  successfulTools: number;
  verifiedStateChanges: number;
  requiredTextMatched: boolean;
}
export interface BenchmarkCaseScore {
  caseId: string;
  attempts: number;
  passed: number;
  passRate: number;
  passAtK: Record<string, number>;
  medianDurationMs: number;
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return out;
}

export function passAtK(total: number, passed: number, k: number): number {
  if (total <= 0 || passed <= 0 || k <= 0) return 0;
  const use = Math.min(total, k);
  if (total - passed < use) return 1;
  return 1 - combinations(total - passed, use) / combinations(total, use);
}

export function scoreAttempts(attempts: BenchmarkAttempt[], ks = [1, 2, 3]): BenchmarkCaseScore[] {
  const grouped = new Map<string, BenchmarkAttempt[]>();
  for (const attempt of attempts) grouped.set(attempt.caseId, [...(grouped.get(attempt.caseId) ?? []), attempt]);
  return [...grouped.entries()].map(([caseId, rows]) => {
    const passed = rows.filter((row) => row.ok).length;
    const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
    return {
      caseId,
      attempts: rows.length,
      passed,
      passRate: passed / rows.length,
      passAtK: Object.fromEntries(ks.map((k) => [String(k), passAtK(rows.length, passed, k)])),
      medianDurationMs: durations[Math.floor(durations.length / 2)] ?? 0,
    };
  });
}
