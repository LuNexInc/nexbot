const base = process.env.NEXBOT_URL || "http://127.0.0.1:8799";

try {
  const response = await fetch(`${base}/api/doctor`, { signal: AbortSignal.timeout(15_000) });
  const report = await response.json();
  if (!response.ok) throw new Error(report.error || `HTTP ${response.status}`);
  process.stdout.write(`NexBot doctor: ${String(report.overall).toUpperCase()}\n`);
  for (const check of report.checks || []) {
    const mark = check.status === "pass" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    process.stdout.write(`[${mark}] ${check.id}: ${check.detail}\n`);
  }
  process.exitCode = report.overall === "fail" ? 1 : 0;
} catch (error) {
  process.stderr.write(`NexBot doctor could not reach ${base}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
