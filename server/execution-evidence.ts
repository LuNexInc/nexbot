import { createHash } from "node:crypto";

import { newId } from "./contracts.ts";
import { openStoreDb } from "./db.ts";

export type ReceiptStatus = "running" | "succeeded" | "failed" | "blocked" | "interrupted";
export type VerificationStatus = "not_requested" | "pending" | "changed" | "unchanged" | "unavailable";

export interface ExecutionReceipt {
  id: string;
  botId: string;
  threadId: string;
  jobId?: string;
  itemId?: string;
  eventId?: string;
  action: string;
  status: ReceiptStatus;
  verification: VerificationStatus;
  evidenceType: "provider_completion" | "visual_state_change";
  beforeHash?: string;
  afterHash?: string;
  startedAt: number;
  completedAt?: number;
}

const latestFrame = new Map<string, string>();
const pendingVisual = new Map<string, string[]>();

function persist(receipt: ExecutionReceipt): ExecutionReceipt {
  openStoreDb().prepare(
    `INSERT INTO execution_receipts
      (id, bot_id, thread_id, job_id, item_id, action, status, verification, started_at, completed_at, json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       verification = excluded.verification,
       completed_at = excluded.completed_at,
       json = excluded.json`,
  ).run(
    receipt.id,
    receipt.botId,
    receipt.threadId,
    receipt.jobId ?? null,
    receipt.itemId ?? null,
    receipt.action,
    receipt.status,
    receipt.verification,
    receipt.startedAt,
    receipt.completedAt ?? null,
    JSON.stringify(receipt),
  );
  return receipt;
}

function readReceipt(id: string): ExecutionReceipt | null {
  const row = openStoreDb().prepare("SELECT json FROM execution_receipts WHERE id = ?").get(id) as { json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.json) as ExecutionReceipt; } catch { return null; }
}

export function frameHash(base64: string): string {
  return createHash("sha256").update(base64).digest("hex");
}

export function startReceipt(input: {
  botId: string;
  threadId: string;
  jobId?: string;
  itemId?: string;
  eventId?: string;
  action: string;
  visual?: boolean;
}): ExecutionReceipt {
  const beforeHash = input.visual ? latestFrame.get(input.botId) : undefined;
  return persist({
    id: newId(),
    botId: input.botId,
    threadId: input.threadId,
    jobId: input.jobId,
    itemId: input.itemId,
    eventId: input.eventId,
    action: input.action.slice(0, 240),
    status: "running",
    verification: input.visual ? "pending" : "not_requested",
    evidenceType: input.visual ? "visual_state_change" : "provider_completion",
    beforeHash,
    startedAt: Date.now(),
  });
}

export function completeReceipt(id: string, ok: boolean): ExecutionReceipt | null {
  const receipt = readReceipt(id);
  if (!receipt) return null;
  receipt.status = ok ? "succeeded" : "failed";
  receipt.completedAt = Date.now();
  if (receipt.evidenceType === "visual_state_change") {
    if (!receipt.beforeHash) receipt.verification = "unavailable";
    else {
      receipt.verification = "pending";
      const queue = pendingVisual.get(receipt.botId) ?? [];
      queue.push(receipt.id);
      pendingVisual.set(receipt.botId, queue.slice(-20));
    }
  }
  return persist(receipt);
}

export function interruptReceipts(botId: string): ExecutionReceipt[] {
  const rows = openStoreDb().prepare(
    "SELECT json FROM execution_receipts WHERE bot_id = ? AND status = 'running' ORDER BY started_at ASC",
  ).all(botId) as Array<{ json: string }>;
  const changed: ExecutionReceipt[] = [];
  for (const row of rows) {
    try {
      const receipt = JSON.parse(row.json) as ExecutionReceipt;
      receipt.status = "interrupted";
      receipt.completedAt = Date.now();
      if (receipt.verification === "pending") receipt.verification = "unavailable";
      persist(receipt);
      changed.push(receipt);
    } catch {}
  }
  return changed;
}

/** Record a real desktop frame and settle completed computer actions against it. */
export function observeFrame(botId: string, pngBase64: string): ExecutionReceipt[] {
  const hash = frameHash(pngBase64);
  latestFrame.set(botId, hash);
  const ids = pendingVisual.get(botId) ?? [];
  if (!ids.length) return [];
  pendingVisual.delete(botId);
  const changed: ExecutionReceipt[] = [];
  for (const id of ids) {
    const receipt = readReceipt(id);
    if (!receipt || receipt.verification !== "pending") continue;
    receipt.afterHash = hash;
    receipt.verification = receipt.beforeHash === hash ? "unchanged" : "changed";
    persist(receipt);
    changed.push(receipt);
  }
  return changed;
}

export function listReceipts(filter: { botId?: string; jobId?: string; limit?: number } = {}): ExecutionReceipt[] {
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  let sql = "SELECT json FROM execution_receipts";
  const args: Array<string | number | null> = [];
  const where: string[] = [];
  if (filter.botId) { where.push("bot_id = ?"); args.push(filter.botId); }
  if (filter.jobId) { where.push("job_id = ?"); args.push(filter.jobId); }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY started_at DESC LIMIT ?";
  args.push(limit);
  const rows = openStoreDb().prepare(sql).all(...args) as Array<{ json: string }>;
  return rows.flatMap((row) => { try { return [JSON.parse(row.json) as ExecutionReceipt]; } catch { return []; } });
}
