// Guaranteed handoff resolution — the "I'll ping you back" promise.
//
// ask_bot is synchronous (the delegator waits and replies in-turn), so it needs
// no promise. send_bot queues work async and the delegator's turn ends after
// announcing the handoff; the promised ping-back must not depend on the model
// remembering, on completionPings, or on a generic report being meaningful.
// This module records the promise and lets the harness resolve it against the
// target's completion, in the delegator's own thread, with the result.
import { newId } from "./contracts.ts";

export interface HandoffPromise {
  id: string;
  fromBotId: string;
  fromThreadId: string;
  toBotId: string;
  request: string;
  at: number;
}

// keyed by the target bot that owes the work
const pending = new Map<string, HandoffPromise[]>();

export function recordHandoffPromise(input: {
  fromBotId: string;
  fromThreadId: string;
  toBotId: string;
  request: string;
}): HandoffPromise | null {
  const { fromBotId, fromThreadId, toBotId, request } = input;
  if (!fromBotId || !toBotId || fromBotId === toBotId) return null;
  const row: HandoffPromise = { id: newId(), fromBotId, fromThreadId, toBotId, request, at: Date.now() };
  const list = pending.get(toBotId) ?? [];
  list.push(row);
  pending.set(toBotId, list);
  return row;
}

/** Pop the oldest promise for a target (FIFO, since queued work runs one task
 * at a time) — leave the rest for the target's later completions. */
export function takeNextHandoffPromiseForTarget(toBotId: string): HandoffPromise | null {
  const list = pending.get(toBotId);
  if (!list?.length) return null;
  const row = list.shift()!;
  if (list.length === 0) pending.delete(toBotId);
  return row;
}

/** Peek (no mutation) — used for diagnostics and the CoS double-report check. */
export function handoffPromisesForTarget(toBotId: string): HandoffPromise[] {
  return pending.get(toBotId) ?? [];
}

export function clearHandoffPromisesForTarget(toBotId: string): void {
  pending.delete(toBotId);
}
