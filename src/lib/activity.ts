/** Chat activity pills that are harness guts — hide these; the reply is the story. */

const GUTS_TOOLS = new Set([
  "list_dir",
  "read_file",
  "write_file",
  "delete_file",
  "grep",
  "search_tool",
  "use_tool",
  "search_replace",
  "glob",
  "glob_file_search",
  "str_replace",
  "edit_file",
  "codebase_search",
  "file_search",
  "read",
  "ls",
  "find",
  "cat",
  "bash",
  "shell",
  "tool",
  "write",
]);

const GUTS_PREFIX =
  /^(list_|read_|write_|edit_|delete_|search_|glob|grep|use_tool|str_replace|apply_patch|codebase_|file_search|git\b)/i;

function toolKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type ActivityLike = {
  kind?: string;
  tool?: { name?: string; ok?: boolean };
};

/** True when this activity is internal tool guts and must not render as a pill. */
export function isGutsActivity(message: ActivityLike): boolean {
  if (message.kind !== "activity") return false;
  const name = message.tool?.name?.trim() ?? "";
  if (!name) return true;
  if (/^error:/i.test(name)) return false;
  const key = toolKey(name);
  if (GUTS_TOOLS.has(key) || GUTS_PREFIX.test(key)) return true;
  if (/^asked\s+@/i.test(name)) return true;
  if (/^@\S+\s*(→|->)\s*@/.test(name)) return true;
  // git / powershell / any other tool title is still guts — busy dots already exist
  return true;
}

/** Leading working-narration: I'll-pull / I'll-confirm / updating-the-note / I'll-give-you. */
const NARRATION_HEAD =
  /^(?:i['’]ll\s+(?:pull|check|look first|confirm|give you)\b|checking\b|updating the (?:note|day note|day log|dated note|session note)\b|writing a short handoff\b|let me see\b)/i;

/** Same phrases after a dash or mid-sentence so concatenated preamble still drops. */
const NARRATION_INNER =
  /\b(?:i['’]ll\s+(?:pull|check|look first|confirm|give you)\b|updating the (?:note|day note|day log|dated note|session note)\b|writing a short handoff\b)/i;

function isNarrationSentence(sentence: string): boolean {
  const t = sentence.trim();
  if (!t) return true;
  return NARRATION_HEAD.test(t) || NARRATION_INNER.test(t);
}

/** Drop I'll-pull / I'll-confirm / updating-the-note / I'll-give-you sentences. Empty = hide the bubble. */
export function stripWorkingNarration(text: string): string {
  const rest = text
    .trim()
    .replace(/([.!?])(?=[A-Z"“])/g, "$1 ")
    .replace(/…\s*(?=i['’]ll\b|updating\b|checking\b|writing a short handoff\b|let me see\b)/gi, ". ");
  const parts = rest.split(/(?<=[.!?])\s+/).filter((p) => p.trim());
  return parts.filter((p) => !isNarrationSentence(p)).join(" ").trim();
}

/** True when the whole text is working narration (no real answer left). */
export function isWorkingNarration(text: string): boolean {
  return Boolean(text.trim()) && stripWorkingNarration(text) === "";
}
