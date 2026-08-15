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

export type ChatMessageLike = {
  source?: "user" | "agent" | "routine" | "proactive" | "completion";
  text?: string;
};

/** Hide control prompts and empty background checks from the answer stream. */
export function isLowValueSystemMessage(message: ChatMessageLike): boolean {
  const text = message.text?.trim() ?? "";
  if (message.source === "completion") return true;
  if (message.source !== "proactive") return false;
  if (/\[Task-triggered check:/i.test(text)) return true;
  return /\bNO_UPDATE\s*$/i.test(text);
}

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

/** Leading working-narration: I'll-pull / I'll-confirm / updating-the-note / I'll-give-you / I'll-start. */
const NARRATION_HEAD =
  /^(?:i['’]ll\s+(?:pull|check|look|confirm|give|start|send|route|read|write|follow|get|fetch|update|review|run|list|tell|sync|open)\b|let me\s+(?:see|check|look|start|review|read|run|pull|sync)\b|next\s+i['’]ll\b|checking\b|updating the (?:note|day note|day log|dated note|session note|handoff)\b|writing\s+(?:a short handoff|the day note|the session note|the desk copy|the handoff|luna['’]s brief|the brief)\b|following the .*\bskill\b|workspace name is\b|i have the disk sources\b|\w+(?:['’]s)?\s+(?:brief is in|is free)\b)/i;

/** Same phrases after a dash or mid-sentence so concatenated preamble still drops. */
const NARRATION_INNER =
  /\b(?:i['’]ll\s+(?:pull|check|look|confirm|give|start|send|route|read|write|follow|get|fetch|update|review|run|list|tell|sync|open)\b|next\s+i['’]ll\b|updating the (?:note|day note|day log|dated note|session note|handoff)\b|writing\s+(?:a short handoff|the day note|the session note|the desk copy|the handoff)\b|following the .*\bskill\b)/i;

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

export type ExtractedThinking = {
  thinking: string | null;
  cleanText: string;
};

/** Extracts thinking/reasoning tags (<think>, <thought>, <reasoning>) from model output. */
export function extractThinking(text: string): ExtractedThinking {
  if (!text) return { thinking: null, cleanText: "" };
  let thinking: string | null = null;
  let cleanText = text.trim();

  // Match closed tags: <think>...</think> or <thought>...</thought> or <reasoning>...</reasoning>
  const match = cleanText.match(/<(think|thought|reasoning)>([\s\S]*?)<\/\1>/i);
  if (match) {
    thinking = match[2].trim();
    cleanText = cleanText.replace(match[0], "").trim();
  } else {
    // Check if starts with unclosed tag during streaming
    const unclosed = cleanText.match(/^<(think|thought|reasoning)>([\s\S]*)$/i);
    if (unclosed) {
      thinking = unclosed[2].trim();
      cleanText = "";
    }
  }

  return { thinking: thinking || null, cleanText };
}
