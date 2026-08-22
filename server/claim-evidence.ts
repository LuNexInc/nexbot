// Claim-vs-evidence reconciliation — the "no more lying" layer.
//
// An agent's prose is not evidence. A reply that says "done, I updated it" is
// only as believable as the receipts the turn actually produced. This module
// checks those receipts against the state change the reply implies:
//
//   - a computer action that settled "unchanged"  → the claimed change did NOT
//     happen (the before/after frame hashes matched);
//   - an action that "failed" or was "blocked"     → the claimed work did not
//     complete (provider denial, permission refusal, or tool error);
//   - a computer action still "pending"/"unavailable" at turn end → the claimed
//     state change could not be confirmed.
//
// It returns a summary only when the evidence contradicts or cannot confirm the
// claim, so a clean read-only or fully-verified turn stays quiet. The caller
// surfaces the summary as an honesty badge on the reply and, if desired, feeds
// it back into the model so it verifies next time. See Coherence Debt (a missing
// fact produces wrong work rather than absent work): check what the agent
// produced against its receipts, not what it told you it read.
import type { ExecutionReceipt } from "./execution-evidence.ts";

export type ClaimEvidenceVerdict = "verified" | "partially_verified" | "unverified";

export interface ClaimEvidenceSummary {
  verdict: ClaimEvidenceVerdict;
  /** Number of receipts that flagged a discrepancy (failed + blocked + unchanged). */
  flagged: number;
  /** Free-text honesty note shown to the user. */
  note: string;
  /** Raw counts so tests and a richer UI can break them down. */
  failed: number;
  blocked: number;
  unchanged: number;
  pending: number;
  unavailable: number;
  changed: number;
}

const UNVERIFIED_REASON =
  "NexBot could not verify that the claimed work actually happened, so treat the result as unconfirmed.";

export function assessClaimEvidence(receipts: ExecutionReceipt[]): ClaimEvidenceSummary | null {
  let failed = 0;
  let blocked = 0;
  let unchanged = 0;
  let pending = 0;
  let unavailable = 0;
  let changed = 0;
  let visualClaimed = 0;

  for (const receipt of receipts) {
    if (receipt.status === "failed") failed++;
    if (receipt.status === "blocked") blocked++;

    if (receipt.evidenceType === "visual_state_change") {
      visualClaimed++;
      switch (receipt.verification) {
        case "changed":
          changed++;
          break;
        case "unchanged":
          unchanged++;
          break;
        case "pending":
          pending++;
          break;
        case "unavailable":
          unavailable++;
          break;
        // "not_requested" on a visual receipt means no before-frame was captured
        // — treat as unable to confirm.
        default:
          unavailable++;
      }
    }
  }

  const flagged = failed + blocked + unchanged;

  // Strong contradiction: a failure/denial, or a state change claimed but not
  // observed (before/after frame hashes matched). Report as unverified.
  if (flagged > 0) {
    const parts: string[] = [];
    if (unchanged) parts.push(`${unchanged} computer action(s) reported no state change`);
    if (failed) parts.push(`${failed} action(s) failed`);
    if (blocked) parts.push(`${blocked} action(s) were blocked`);
    const note = `${parts.join("; ")}. ${UNVERIFIED_REASON}`;
    return { verdict: "unverified", flagged, note, failed, blocked, unchanged, pending, unavailable, changed };
  }

  // No contradiction, but computer actions that could not be confirmed to have
  // changed anything. Report as partially verified so the caveat is visible.
  if (visualClaimed > 0 && (pending > 0 || unavailable > 0)) {
    const count = pending + unavailable;
    const note =
      `${count} computer action(s) could not be confirmed to have changed anything` +
      `${changed > 0 ? ` (${changed} did verify)` : ""}. ${UNVERIFIED_REASON}`;
    return {
      verdict: "partially_verified",
      flagged: count,
      note,
      failed,
      blocked,
      unchanged,
      pending,
      unavailable,
      changed,
    };
  }

  // State-changing actions all verified, or a turn with nothing state-changing
  // to verify. No caveat — stay quiet.
  return null;
}

/** Compact, relay-friendly caveat (e.g. "1 computer action reported no state
 * change") distilled from the full note — short enough to prefix a delegating
 * bot's relay or a completion-report line without burying the reply. */
export function shortCaveat(note: string): string {
  if (!note) return "";
  const cut = note.indexOf("NexBot could not verify");
  const head = cut >= 0 ? note.slice(0, cut) : note;
  return head.replace(/[.;]\s*$/, "").trim();
}
