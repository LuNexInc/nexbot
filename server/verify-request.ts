// Bounded verify-after-unverified pass. When a user-initiated turn completes
// with a claim the evidence contradicts (verdict "unverified"), the harness
// arms ONE verification-only follow-up on that bot: it re-checks the state it
// claimed, and reports honestly instead of asserting. This attacks the class of
// dishonesty that receipts alone can't catch — an overstatement of work that
// isn't tied to a specific failed/unchanged action.
//
// It is deliberately one-shot per unverified turn, never re-arms from a verify
// turn's own completion, and is skipped when the operator owns the computer.
// No new work is requested — the bot is told to verify only.
const pending = new Map<string, { caveat: string; at: number }>();

export function isVerifyPending(botId: string): boolean {
  return pending.has(botId);
}

/** Arm a verify pass. Returns false when one is already pending (no dupes). */
export function armVerify(botId: string, caveat: string): boolean {
  if (!botId || !caveat.trim()) return false;
  if (pending.has(botId)) return false;
  pending.set(botId, { caveat: caveat.trim(), at: Date.now() });
  return true;
}

/** Return and clear the pending verify caveat, or null if none. */
export function takeVerify(botId: string): string | null {
  const row = pending.get(botId);
  if (!row) return null;
  pending.delete(botId);
  return row.caveat;
}

export function clearVerify(botId: string): void {
  pending.delete(botId);
}

/** The verification-only instruction injected into the follow-up turn. */
export function verifyPrompt(caveat: string): string {
  return (
    `[Verification pass]\n\n` +
    `Your last reply made a claim that the evidence on this PC does not support: ${caveat}\n\n` +
    `On this turn do NOT start new work, take new actions, delegate, or reach out. Instead verify what you claimed: ` +
    `inspect the actual state (the file, env, desktop frame, or output) you said you changed, determine whether it ` +
    `really is as you described, and reply honestly. If the claim was wrong, correct it plainly. If you can confirm ` +
    `it, show the evidence. Keep it short and factual.`
  );
}
