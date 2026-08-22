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

// Payload bounds to prevent buffer overflow, token stuffing, and unbounded execution
export const MAX_COMMAND_LENGTH = 4000;
export const MAX_CUA_TEXT_LENGTH = 10000;
export const MAX_URL_LENGTH = 2048;
export const MAX_KEY_LENGTH = 100;

// Dangerous characters: ASCII control chars (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F),
// zero-width characters (U+200B..U+200D, U+FEFF), and unicode directional overrides (U+202A..U+202E, U+2066..U+2069).
const DANGEROUS_CHARS_REGEX =
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Strips dangerous control chars, null bytes, zero-width evasion characters, and directional overrides. */
export function stripDangerousChars(input: string): string {
  if (!input) return "";
  return String(input).replace(DANGEROUS_CHARS_REGEX, "");
}

const PROMPT_INJECTION_PATTERNS = [
  // Delimiters / Role markers
  /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>/i,
  /\[\/?INST\]/i,
  /<<\/?SYS>>/i,
  /(?:^|\n|\r)\s*(?:###\s*)?(?:system|assistant|human|user)\s*:\s*(?:ignore|disregard|forget|you are|override|system prompt|bypass)/i,

  // Instruction override / jailbreak phrases
  /\b(?:ignore|disregard|forget|override)[\s_-]+(?:all[\s_-]+)?(?:previous|prior|above|system)[\s_-]+(?:instructions|rules|prompts|directives|constraints|guidelines)\b/i,
  /\b(?:you[\s_-]+are[\s_-]+now|act[\s_-]+as)[\s_-]+(?:in[\s_-]+)?(?:developer[\s_-]+mode|dan[\s_-]+mode|unrestricted|god[\s_-]+mode|jailbroken)\b/i,
  /\b(?:bypass|disable|override)[\s_-]+(?:all[\s_-]+)?(?:safety|security|content)[\s_-]+(?:filters|protocols|guards|restrictions|checks)\b/i,
  /\b(?:reveal|output|print|dump|show)[\s_-]+(?:your[\s_-]+)?(?:system[\s_-]+prompt|initial[\s_-]+instructions|secret[\s_-]+instructions|base[\s_-]+prompt)\b/i,
];

/** Check if text contains known prompt injection or jailbreak patterns. */
export function isPromptInjection(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const cleaned = stripDangerousChars(text).normalize("NFKC");
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(cleaned));
}

/**
 * Safely quote an argument for POSIX shell execution.
 * Encloses in single quotes and escapes embedded single quotes.
 * Also strips null bytes and dangerous control characters.
 */
export function escapeShellArg(arg: string): string {
  if (!arg) return "''";
  const cleaned = stripDangerousChars(String(arg));
  return `'${cleaned.replace(/'/g, "'\\''")}'`;
}

/**
 * Sanitize shell command payload: enforces length bounds and strips null bytes/control chars.
 */
export function sanitizeShellCommand(command: string, maxLength = MAX_COMMAND_LENGTH): string {
  if (!command) return "";
  const cleaned = stripDangerousChars(String(command));
  return cleaned.slice(0, maxLength);
}

/**
 * Sanitize CUA typing payload: enforces bounds and strips null bytes and control chars.
 */
export function sanitizeCuaText(text: string, maxLength = MAX_CUA_TEXT_LENGTH): string {
  if (!text) return "";
  const cleaned = stripDangerousChars(String(text));
  return cleaned.slice(0, maxLength);
}

/**
 * Sanitize URL payload for browser opening: validates protocol, enforces bounds,
 * strips whitespace/newlines/control chars, and rejects shell metacharacters.
 */
export function sanitizeUrl(url: string, maxLength = MAX_URL_LENGTH): string | null {
  if (!url || typeof url !== "string") return null;
  const cleaned = stripDangerousChars(url.trim()).slice(0, maxLength);
  if (!/^https?:\/\/[^\s<>"'`$;|&\\()]+$/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * Sanitize key press sequence for xdotool / CUA keys:
 * bounds check and strict character allowlist (alphanumerics, underscore, plus, hyphen).
 */
export function sanitizeKeySequence(keys: string, maxLength = MAX_KEY_LENGTH): string {
  if (!keys) return "";
  const cleaned = stripDangerousChars(String(keys)).slice(0, maxLength);
  return cleaned.replace(/[^\w+_-]/g, "");
}

/**
 * Guard check for tool execution payloads: inspects for environ harvest and prompt injection.
 */
export function isForbiddenToolPayload(input: {
  path?: unknown;
  command?: unknown;
  text?: unknown;
  url?: unknown;
  title?: unknown;
  raw?: unknown;
}): { forbidden: boolean; reason?: string } {
  if (isForbiddenSecretAccess(input)) {
    return { forbidden: true, reason: "blocked a request to read process environment secrets" };
  }
  const chunks: unknown[] = [input.command, input.text, input.url, input.title];
  if (input.raw && typeof input.raw === "object") {
    chunks.push(...Object.values(input.raw as Record<string, unknown>));
  } else if (typeof input.raw === "string") {
    chunks.push(input.raw);
  }
  for (const c of chunks) {
    if (typeof c === "string" && isPromptInjection(c)) {
      return { forbidden: true, reason: "blocked a potential prompt injection payload" };
    }
  }
  return { forbidden: false };
}
