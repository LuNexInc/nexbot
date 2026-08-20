import { newId } from "./contracts.ts";
import { openStoreDb } from "./db.ts";

export type TurnDelivery = "queue" | "steer";
export interface QueuedTurn {
  id: string;
  botId: string;
  text: string;
  messageId: string;
  clientNonce?: string;
  delivery: TurnDelivery;
  createdAt: number;
}
export function enqueueTurn(input: Omit<QueuedTurn, "id" | "createdAt">): QueuedTurn {
  const row: QueuedTurn = { ...input, id: newId(), createdAt: Date.now() };
  const priority = row.delivery === "steer" ? 10 : 0;
  openStoreDb().prepare(
    "INSERT INTO queued_turns (id, bot_id, priority, created_at, json) VALUES (?, ?, ?, ?, ?)",
  ).run(row.id, row.botId, priority, row.createdAt, JSON.stringify(row));
  return row;
}

export function queuedTurns(botId: string): QueuedTurn[] {
  const rows = openStoreDb().prepare(
    "SELECT json FROM queued_turns WHERE bot_id = ? ORDER BY priority DESC, created_at ASC",
  ).all(botId) as Array<{ json: string }>;
  return rows.flatMap((row) => { try { return [JSON.parse(row.json) as QueuedTurn]; } catch { return []; } });
}

export function takeNextTurn(botId: string): QueuedTurn | null {
  const next = queuedTurns(botId)[0];
  if (!next) return null;
  openStoreDb().prepare("DELETE FROM queued_turns WHERE id = ?").run(next.id);
  return next;
}

export function removeQueuedTurnsForBot(botId: string): void {
  openStoreDb().prepare("DELETE FROM queued_turns WHERE bot_id = ?").run(botId);
}
