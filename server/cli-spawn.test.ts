import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveCli, spawnCli, stopChild, unwrapCmdShim } from "./cli-spawn.ts";
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

  it("unwrapCmdShim parses npm .cmd shims on Windows to target JS directly", () => {
    if (process.platform !== "win32") return;
    dir = mkdtempSync(join(tmpdir(), "nexbot-cli-"));
    const distDir = join(dir, "dist");
    mkdirSync(distDir, { recursive: true });
    const targetJs = join(distDir, "cli.js");
    const cmdFile = join(dir, "cli.cmd");
    writeFileSync(targetJs, "console.log('unwrapped');\n");
    writeFileSync(
      cmdFile,
      `@ECHO off\r\n"%_prog%"  "%dp0%\\dist\\cli.js" %*\r\n`,
    );
    const unwrapped = unwrapCmdShim(cmdFile);
    expect(unwrapped).not.toBeNull();
    expect(unwrapped?.command).toBe(process.execPath);
    expect(unwrapped?.extraArgs[0]).toBe(targetJs);
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
    void stopChild(child);
  });

  const winOnly = it.runIf(process.platform === "win32");

  winOnly("spawnCli fails closed on a non-Node .cmd shim (no shell injection)", async () => {
    dir = mkdtempSync(join(tmpdir(), "nexbot-cli-"));
    const cmd = join(dir, "probe.cmd");
    writeFileSync(cmd, "@echo off\r\necho ARGS=%*\r\n");
    const warnings: string[] = [];
    const onWarn = (w: { code?: string }) => {
      if (w.code) warnings.push(w.code);
    };
    process.on("warning", onWarn);
    try {
      expect(() =>
        spawnCli(cmd, ["--model", "gpt-5"], {
          env: { ...process.env, PATH: augmentedPath() },
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ).toThrow(/Unsupported Windows wrapper/);
      expect(warnings).not.toContain("DEP0190");
    } finally {
      process.off("warning", onWarn);
    }
  });
});
