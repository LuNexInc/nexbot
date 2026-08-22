// Shared ask_bot wait contract: the MCP tool must block until the target
// bot finishes (or this ceiling), then return the reply (or a still-working
// note) so the caller's turn can continue and summarize.
export const ASK_BOT_WAIT_MS = 4 * 60_000;
export const ASK_BOT_HTTP_TIMEOUT_MS = ASK_BOT_WAIT_MS + 15_000;
export const ASK_BOT_STILL_WORKING =
  "That bot is still working — try again after it finishes.";

export const MAX_TOOL_OUTPUT_BYTES = 16_000;

export function boundToolOutput(str: string, maxBytes = MAX_TOOL_OUTPUT_BYTES): string {
  if (!str || str.length <= maxBytes) return str;
  const keep = Math.floor(maxBytes / 2);
  const head = str.slice(0, keep);
  const tail = str.slice(-keep);
  const truncated = str.length - keep * 2;
  return `${head}\n\n[... truncated ${truncated} bytes ...]\n\n${tail}`;
}
