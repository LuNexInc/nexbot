import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveCli, spawnCli, stopChild } from "./cli-spawn.ts";
import { augmentedPath, resetPathCacheForTests } from "./env-path.ts";

describe("cli-spawn", () => {
  let dir: string;

  afterEach(() => {
    resetPathCacheForTests();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("resolveCli returns absolute path when file exists", () => {
    dir = mkdtempSync(join(tmpdir(), "nexbot-cli-"));
    const bin = join(dir, process.platform === "win32" ? "tool.cmd" : "tool");
    writeFileSync(bin, process.platform === "win32" ? "@echo off\r\necho ok\r\n" : "#!/bin/sh\necho ok\n");
    expect(resolveCli(bin)).toBe(bin);
  });

  it("spawnCli runs a local script and stopChild does not throw", async () => {
    dir = mkdtempSync(join(tmpdir(), "nexbot-cli-"));
    const script = join(dir, "echo-hi.js");
    writeFileSync(script, "console.log('hi-from-cli')\n");
    const child = spawnCli(process.execPath, [script], {
      env: { ...process.env, PATH: augmentedPath() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = await new Promise<string>((resolve, reject) => {
      let buf = "";
      child.stdout?.on("data", (c) => (buf += c));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(buf) : reject(new Error(`exit ${code}: ${buf}`))));
    });
    expect(out).toContain("hi-from-cli");
    stopChild(child);
  });
});
