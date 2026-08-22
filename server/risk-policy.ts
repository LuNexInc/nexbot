export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskCategory = "read" | "local" | "destructive" | "critical" | "unknown";
export type PermissionMode = "readonly" | "workspace" | "full";

export interface RiskDecision {
  level: RiskLevel;
  action: "allow" | "ask" | "deny";
  reason: string;
  /** Stable category of the action so a per-bot permission mode can gate it. */
  category: RiskCategory;
}
const CRITICAL = /\b(?:format|mkfs|diskpart|delete\s+account|drop\s+(?:database|table)|transfer\s+(?:money|funds)|wire\s+money|publish|deploy\s+production|send\s+(?:email|message)|post\s+(?:publicly|to)|revoke|rotate\s+(?:key|token)|password|credential|secret)\b/i;
const HIGH = /\b(?:rm\s+-rf|remove-item.*-recurse|delete|overwrite|move|rename|install|uninstall|purchase|checkout|submit|upload|download|git\s+push|release|sign|approve|merge)\b/i;
const MEDIUM = /\b(?:write|edit|patch|create|mkdir|git\s+commit|browser|click|type|press|scroll|execute|shell|terminal|command)\b/i;
const READ_ONLY = /\b(?:read|search|list|find|inspect|view|get|status|health|screenshot|query)\b/i;

/** Classify a provider permission request. Unknown actions require approval. */
export function classifyPermission(tool: string, summary: string): RiskDecision {
  const text = `${tool} ${summary}`.trim();

  // NexBot's own peer-coordination and memory tools are internal: they read
  // bot lists and history, manage todos, or hand a message to another bot in
  // this workspace. They have no external, durable, or credential effect, so
  // auto-allow them rather than spamming the operator while a teammate works.
  if (/^(?:agents|todos|memory|skills?)__/i.test(summary)) {
    return { level: "low", action: "allow", category: "read", reason: "Internal NexBot coordination tool (no external effect)." };
  }

  // Reading a web URL (research fetch) is read-only and safe to allow.
  if (tool.toLowerCase() === "fetch" || /^fetch\s*:/i.test(summary)) {
    return { level: "low", action: "allow", category: "read", reason: "Read-only web fetch." };
  }

  if (CRITICAL.test(text)) return { level: "critical", action: "ask", category: "critical", reason: "This action can affect credentials, money, production, or another person." };
  if (HIGH.test(text)) return { level: "high", action: "ask", category: "destructive", reason: "This action can make a durable or destructive change." };
  if (READ_ONLY.test(text) && !MEDIUM.test(text)) return { level: "low", action: "allow", category: "read", reason: "This request is read-only." };
  if (MEDIUM.test(text)) return { level: "medium", action: "allow", category: "local", reason: "This request is a reversible local action." };
  return { level: "high", action: "ask", category: "unknown", reason: "NexBot cannot prove that this action is low risk." };
}

/** Apply a per-bot permission mode (like a modern CLI permission flag) on top
 * of the base classification.
 * - readonly: only read-only actions are auto-allowed; every write, command,
 *   destructive, external, credential, or unknown action still asks.
 * - workspace: the module default — reads + reversible local actions
 *   auto-allowed; destructive/external/credential/unknown still ask.
 * - full: reads + local + durable/destructive auto-allowed. Critical
 *   (credentials, money, publish, external send) still asks unless
 *   `allowCritical` is true. Unknown actions always still ask. */
export function applyPermissionMode(decision: RiskDecision, mode: PermissionMode | undefined, allowCritical = false): RiskDecision {
  if (mode === "readonly") {
    if (decision.category === "read") return decision;
    return { ...decision, action: "ask" };
  }
  if (mode === "full") {
    if (decision.category === "read" || decision.category === "local" || decision.category === "destructive") {
      return { ...decision, action: "allow", reason: "Full access mode: this action is auto-allowed." };
    }
    if (decision.category === "critical" && allowCritical) {
      return { ...decision, action: "allow", reason: "Full access mode: critical action explicitly allowed." };
    }
    return decision;
  }
  // workspace (and undefined) — leave the base classification as-is.
  return decision;
}
