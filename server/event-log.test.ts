import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, utimesSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendNdjson, nativeLogEnabled, pruneEventLogs } from "./event-log.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexbot-event-log-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("event-log", () => {
  it("appends one JSON line per event", () => {
    appendNdjson(dir, "t1", { n: 1 });
    appendNdjson(dir, "t1", { n: 2 });
    const lines = readFileSync(join(dir, "t1.ndjson"), "utf8").trim().split("\n");
    expect(lines).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("rotates when the live file reaches the size cap", () => {
    const file = join(dir, "big.ndjson");
    writeFileSync(file, "x".repeat(80));
    appendNdjson(dir, "big", { ok: true }, 50);
    expect(readFileSync(`${file}.1`, "utf8")).toBe("x".repeat(80));
    expect(readFileSync(file, "utf8")).toBe('{"ok":true}\n');
  });

  it("prunes files older than the retain window", () => {
    mkdirSync(dir, { recursive: true });
    const stale = join(dir, "old.ndjson");
    writeFileSync(stale, "{}\n");
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    writeFileSync(join(dir, "fresh.ndjson"), "{}\n");
    const result = pruneEventLogs(Date.now(), [dir], 14 * 24 * 60 * 60 * 1000, 5 * 1024 * 1024);
    expect(result.removed).toBe(1);
    expect(() => readFileSync(stale)).toThrow();
    expect(readFileSync(join(dir, "fresh.ndjson"), "utf8")).toBe("{}\n");
  });

  it("treats NEXBOT_NATIVE_LOG=0 as off", () => {
    const prev = process.env.NEXBOT_NATIVE_LOG;
    process.env.NEXBOT_NATIVE_LOG = "0";
    expect(nativeLogEnabled()).toBe(false);
    process.env.NEXBOT_NATIVE_LOG = "1";
    expect(nativeLogEnabled()).toBe(true);
    if (prev === undefined) delete process.env.NEXBOT_NATIVE_LOG;
    else process.env.NEXBOT_NATIVE_LOG = prev;
  });
});
