// Durable turn records. A job remains available after a process exit so the
// owner can resume or retry work instead of losing the original prompt.
import { newId, type ReasoningEffort } from "./contracts.ts";
import { openStoreDb } from "./db.ts";
import type { TaskContext } from "./task-context.ts";

export type JobSource = "user" | "agent" | "routine" | "proactive" | "completion";
export type JobStatus = "running" | "interrupted" | "completed" | "failed";

export type DurableJob = {
  id: string;
  botId: string;
  threadId: string;
  messageId: string;
  text: string;
  source: JobSource;
  taskContext?: TaskContext;
  providerInstanceId: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  resumeCursor?: unknown;
  status: JobStatus;
  attempt: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

function row(job: DurableJob) {
  openStoreDb()
    .prepare("INSERT INTO jobs (id, bot_id, status, updated_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET bot_id=excluded.bot_id, status=excluded.status, updated_at=excluded.updated_at, json=excluded.json")
    .run(job.id, job.botId, job.status, job.updatedAt, JSON.stringify(job));
}

function parse(raw: string): DurableJob | null {
  try {
    const value = JSON.parse(raw) as DurableJob;
    if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.botId !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

export function createJob(input: Omit<DurableJob, "id" | "status" | "attempt" | "createdAt" | "updatedAt">): DurableJob {
  const now = Date.now();
  const job: DurableJob = { ...input, id: newId(), status: "running", attempt: 1, createdAt: now, updatedAt: now };
  row(job);
  return job;
}

export function getJob(id: string): DurableJob | null {
  const found = openStoreDb().prepare("SELECT json FROM jobs WHERE id = ?").get(id) as { json?: string } | undefined;
  return found?.json ? parse(found.json) : null;
}

export function listJobs(opts?: { botId?: string; statuses?: JobStatus[] }): DurableJob[] {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts?.botId) {
    where.push("bot_id = ?");
    params.push(opts.botId);
  }
  if (opts?.statuses?.length) {
    where.push(`status IN (${opts.statuses.map(() => "?").join(",")})`);
    params.push(...opts.statuses);
  }
  const sql = `SELECT json FROM jobs${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
  const rows = openStoreDb().prepare(sql).all(...(params as any[])) as Array<{ json: string }>;
  return rows.map((r) => parse(r.json)).filter((j): j is DurableJob => Boolean(j));
}

export function updateJob(id: string, patch: Partial<Omit<DurableJob, "id" | "createdAt">>): DurableJob | null {
  const current = getJob(id);
  if (!current) return null;
  const next: DurableJob = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: Date.now() };
  row(next);
  return next;
}

export function removeJobsForBot(botId: string): number {
  const result = openStoreDb().prepare("DELETE FROM jobs WHERE bot_id = ?").run(botId) as { changes?: number };
  return Number(result.changes ?? 0);
}

export function recoverableJobs(): DurableJob[] {
  return listJobs({ statuses: ["running", "interrupted"] });
}
