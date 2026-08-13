// Deny-list for process-environ and harness-secret harvest via agent tools.
// The CoS (and every grok/CUA shell/read_file) must not be able to read
// /proc/<pid>/environ or equivalent, or run a command whose obvious purpose
// is dumping process environment secrets. No scrape how-to lives here.

const PROC_ENVIRON =
  /(?:^|\/)proc\/(self|\d+)(?:\/task\/\d+)?\/environ(?:\b|$)/i;

export function normalizeToolPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").trim();
}

/** True for /proc/<pid>/environ, /proc/self/environ, and slash/backslash variants. */
export function isForbiddenEnvironPath(path: string): boolean {
  if (!path) return false;
  return PROC_ENVIRON.test(normalizeToolPath(path));
}

/**
 * True when a shell/exec string's obvious purpose is dumping process
 * environment secrets (environ files, or a process-env dump of another pid).
 */
export function isForbiddenEnvironCommand(command: string): boolean {
  if (!command) return false;
  const n = normalizeToolPath(command);
  if (isForbiddenEnvironPath(n)) return true;
  // Windows WMI/CIM process-environment dump (no /proc equivalent).
  if (/win32_process/i.test(n) && /environment/i.test(n)) return true;
  if (/\bwmic\b/i.test(n) && /\bprocess\b/i.test(n) && /\benvironment\b/i.test(n)) return true;
  return false;
}

/** Tool adapter entry: inspect path/command/title/raw fields from shell or read_file. */
export function isForbiddenSecretAccess(input: {
  path?: unknown;
  command?: unknown;
  title?: unknown;
  raw?: unknown;
}): boolean {
  const chunks: unknown[] = [input.path, input.command, input.title];
  if (input.raw && typeof input.raw === "object") {
    chunks.push(...Object.values(input.raw as Record<string, unknown>));
  } else if (typeof input.raw === "string") {
    chunks.push(input.raw);
  }
  for (const c of chunks) {
    if (typeof c !== "string" || !c) continue;
    if (isForbiddenEnvironPath(c) || isForbiddenEnvironCommand(c)) return true;
  }
  return false;
}

const AGENT_CHILD_SECRET_KEYS = ["NEXBOT_COMMS_TOKEN", "COMMS_TOKEN"] as const;

/** Strip harness comms tokens from the model CLI subprocess env. MCP proxies keep their own env. */
export function scrubAgentChildEnv(env: Record<string, string | undefined>): void {
  for (const k of AGENT_CHILD_SECRET_KEYS) delete env[k];
}
