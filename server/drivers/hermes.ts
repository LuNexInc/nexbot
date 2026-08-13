// Hermes / strict-provider message repair for built-in chat-completions
// drivers (Grok API, DeepSeek-shaped, Codex-shaped). Consecutive assistant
// turns are merged before the wire; reasoning_content is preserved so
// thinking-mode replays do not 400.
export type HermesMessage = {
  role: string;
  content?: unknown;
  reasoning_content?: unknown;
  tool_calls?: unknown;
  [key: string]: unknown;
};

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in (part as object)) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function concatText(a: unknown, b: unknown): string {
  return `${asText(a)}${asText(b)}`;
}

function mergeAssistant<T extends HermesMessage>(a: T, b: T): T {
  const content = concatText(a.content, b.content);
  const reasoning = concatText(a.reasoning_content, b.reasoning_content);
  const toolCalls = [
    ...(Array.isArray(a.tool_calls) ? a.tool_calls : []),
    ...(Array.isArray(b.tool_calls) ? b.tool_calls : []),
  ];
  const merged: T = { ...a, ...b, role: "assistant", content: content || null };
  if (reasoning) merged.reasoning_content = reasoning;
  else delete merged.reasoning_content;
  if (toolCalls.length) merged.tool_calls = toolCalls;
  else delete merged.tool_calls;
  return merged as T;
}

/** Collapse adjacent assistant messages (union tool_calls, concat content + reasoning). */
export function mergeConsecutiveAssistant<T extends HermesMessage>(messages: T[]): T[] {
  const out: T[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === "assistant" && msg.role === "assistant") {
      out[out.length - 1] = mergeAssistant(prev, msg);
    } else {
      out.push({ ...msg });
    }
  }
  return out;
}

/** DeepSeek: delta.reasoning_content. Codex: delta.reasoning or nested .content. */
export function reasoningContentFromDelta(delta: Record<string, unknown> | null | undefined): string {
  if (!delta) return "";
  const nested =
    delta.reasoning && typeof delta.reasoning === "object"
      ? (delta.reasoning as { content?: unknown; text?: unknown }).content ??
        (delta.reasoning as { text?: unknown }).text
      : undefined;
  const v = delta.reasoning_content ?? (typeof delta.reasoning === "string" ? delta.reasoning : nested);
  return typeof v === "string" ? v : "";
}

/** Echo reasoning_content on an assistant message so thinking-mode replay stays valid. */
export function preserveReasoningOnAssistant(
  message: HermesMessage,
  reasoning?: string | null,
): HermesMessage {
  const text =
    (reasoning ?? "").trim() ||
    (typeof message.reasoning_content === "string" ? message.reasoning_content : "");
  if (!text) {
    const copy = { ...message };
    delete copy.reasoning_content;
    return copy;
  }
  return { ...message, reasoning_content: text };
}
