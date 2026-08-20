export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskDecision {
  level: RiskLevel;
  action: "allow" | "ask" | "deny";
  reason: string;
}
const CRITICAL = /\b(?:format|mkfs|diskpart|delete\s+account|drop\s+(?:database|table)|transfer\s+(?:money|funds)|wire\s+money|publish|deploy\s+production|send\s+(?:email|message)|post\s+(?:publicly|to)|revoke|rotate\s+(?:key|token)|password|credential|secret)\b/i;
const HIGH = /\b(?:rm\s+-rf|remove-item.*-recurse|delete|overwrite|move|rename|install|uninstall|purchase|checkout|submit|upload|download|git\s+push|release|sign|approve|merge)\b/i;
const MEDIUM = /\b(?:write|edit|patch|create|mkdir|git\s+commit|browser|click|type|press|scroll|execute|shell|terminal|command)\b/i;
const READ_ONLY = /\b(?:read|search|list|find|inspect|view|get|status|health|screenshot|query)\b/i;

/** Classify a provider permission request. Unknown actions require approval. */
export function classifyPermission(tool: string, summary: string): RiskDecision {
  const text = `${tool} ${summary}`.trim();
  if (CRITICAL.test(text)) return { level: "critical", action: "ask", reason: "This action can affect credentials, money, production, or another person." };
  if (HIGH.test(text)) return { level: "high", action: "ask", reason: "This action can make a durable or destructive change." };
  if (READ_ONLY.test(text) && !MEDIUM.test(text)) return { level: "low", action: "allow", reason: "This request is read-only." };
  if (MEDIUM.test(text)) return { level: "medium", action: "allow", reason: "This request is a reversible local action." };
  return { level: "high", action: "ask", reason: "NexBot cannot prove that this action is low risk." };
}
