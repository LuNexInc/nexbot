import { describe, expect, it, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import { readLog, readProfile, writeLog, writeProfile } from "./desk.ts";
import { LOG_CAP, PROFILE_CAP, compactMemory, enqueueMemoryJob, flushMemoryWorker, pendingMemoryJobs } from "./memory-worker.ts";

const BOT = "bot-mem-worker";

beforeEach(() => {
  rmSync(join(DATA_DIR, "memory"), { recursive: true, force: true });
});

describe("memory-worker", () => {
  it("clips profile to 16KB and log to 8KB", () => {
    writeProfile(BOT, "P".repeat(PROFILE_CAP + 200));
    writeLog(BOT, "L".repeat(LOG_CAP + 200));
    compactMemory(BOT);
    expect(readProfile(BOT).length).toBe(PROFILE_CAP);
    expect(readLog(BOT).length).toBe(LOG_CAP);
  });

  it("appends a note then clips", () => {
    writeProfile(BOT, "facts");
    compactMemory(BOT, "filed the invoices");
    expect(readProfile(BOT)).toBe("facts");
    expect(readLog(BOT)).toMatch(/filed the invoices/);
  });

  it("enqueueMemoryJob does not drain inline", () => {
    writeProfile(BOT, "x");
    enqueueMemoryJob(BOT, "queued note");
    expect(pendingMemoryJobs()).toBeGreaterThanOrEqual(1);
    expect(readLog(BOT)).not.toMatch(/queued note/);
    flushMemoryWorker();
    expect(readLog(BOT)).toMatch(/queued note/);
  });
});
