// Reflexion-style "verify next time" feedback for the claim-vs-evidence layer.
//
// When a turn's reply is flagged unverified (the evidence contradicted the
// claim), we store a short honesty note and inject it into the bot's NEXT turn
// system prompt so it verifies that state actually changed before claiming it.
// It is transient and consumed-on-read — it is not durable memory, so it cannot
// accumulate or be echoed back forever.
const pending = new Map<string, { note: string; at: number }>();

const MAX_NOTE_LENGTH = 400;

export function setClaimFeedback(botId: string, note: string): void {
  const trimmed = note.trim();
  if (!botId || !trimmed) return;
  pending.set(botId, { note: trimmed.slice(0, MAX_NOTE_LENGTH), at: Date.now() });
}

/** Return and clear the pending note for a bot, so it is injected exactly once. */
export function takeClaimFeedback(botId: string): string | null {
  const row = pending.get(botId);
  if (!row) return null;
  pending.delete(botId);
  return row.note;
}

export function clearClaimFeedback(botId: string): void {
  pending.delete(botId);
}

/** The instructional sentence appended to the next turn's system prompt. */
export function claimFeedbackPrompt(note: string): string {
  return (
    `Honesty note from your previous turn: ${note} ` +
    `On this turn, confirm that state actually changed (check the environment, file, or frame) before you claim it in your reply. ` +
    `If you cannot verify an outcome, say so instead of asserting it.`
  );
}
