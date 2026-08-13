// Shared ask_bot wait contract: the MCP tool must block until the target
// bot finishes (or this ceiling), then return the reply (or a still-working
// note) so the caller's turn can continue and summarize.
export const ASK_BOT_WAIT_MS = 4 * 60_000;
export const ASK_BOT_HTTP_TIMEOUT_MS = ASK_BOT_WAIT_MS + 15_000;
export const ASK_BOT_STILL_WORKING =
  "That bot is still working — try again after it finishes.";
