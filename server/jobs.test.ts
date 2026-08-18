import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeStoreDb } from "./db.ts";
import { createJob, getJob, listJobs, removeJobsForBot, updateJob } from "./jobs.ts";

beforeEach(() => {
  closeStoreDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
});
afterEach(() => closeStoreDb());

describe("durable jobs", () => {
  it("persists job state and provider checkpoints", () => {
    const job = createJob({
      botId: "bot-1",
      threadId: "thread-1",
      messageId: "message-1",
      text: "write the report",
      source: "user",
      providerInstanceId: "claude",
      model: "claude-sonnet-5",
    });
    updateJob(job.id, { resumeCursor: "session-1" });
    expect(getJob(job.id)).toMatchObject({ status: "running", resumeCursor: "session-1", attempt: 1 });

    closeStoreDb();
    expect(getJob(job.id)).toMatchObject({ resumeCursor: "session-1" });
  });

  it("lists recoverable jobs and removes a bot's jobs", () => {
    const first = createJob({ botId: "bot-1", threadId: "t1", messageId: "m1", text: "one", source: "user", providerInstanceId: "codex", model: "gpt-5" });
    const second = createJob({ botId: "bot-2", threadId: "t2", messageId: "m2", text: "two", source: "routine", providerInstanceId: "grok", model: "grok-4.5" });
    updateJob(second.id, { status: "completed" });
    expect(listJobs({ statuses: ["running", "interrupted"] }).map((j) => j.id)).toEqual([first.id]);
    expect(removeJobsForBot("bot-1")).toBe(1);
    expect(getJob(first.id)).toBeNull();
  });

  it("persists onComplete pipeline and maxTokens ceiling", () => {
    const job = createJob({
      botId: "bot-research",
      threadId: "t1",
      messageId: "m1",
      text: "research",
      source: "routine",
      providerInstanceId: "antigravity",
      model: "gemini-3.7-flash-medium",
      onComplete: { targetBotId: "bot-builder", messageTemplate: "handoff to builder" },
      maxTokens: 80_000,
    });
    expect(getJob(job.id)).toMatchObject({
      onComplete: { targetBotId: "bot-builder", messageTemplate: "handoff to builder" },
      maxTokens: 80_000,
    });
  });

  it("persists error context and tracks retry attempts", () => {
    const job = createJob({
      botId: "bot-1",
      threadId: "t1",
      messageId: "m1",
      text: "deploy service",
      source: "user",
      providerInstanceId: "codex",
      model: "gpt-5",
    });

    updateJob(job.id, { status: "failed", error: "deployment timeout after 60s" });
    expect(getJob(job.id)).toMatchObject({
      status: "failed",
      error: "deployment timeout after 60s",
      attempt: 1,
    });

    const retried = updateJob(job.id, {
      status: "running",
      attempt: job.attempt + 1,
      error: undefined,
      text: '[Reflexion Recovery - Previous failure context: "deployment timeout after 60s"]\nDiagnose why the previous attempt failed and adjust your strategy to complete the original task:\n\ndeploy service',
    });
    expect(retried).toMatchObject({
      status: "running",
      attempt: 2,
      error: undefined,
    });
    expect(getJob(job.id)?.text).toContain("Reflexion Recovery");
  });
});
