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
});
