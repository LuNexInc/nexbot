import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import {
  appendLog,
  buildPersona,
  deskPath,
  ensureDesk,
  ensureMemory,
  existsMemory,
  logPath,
  memoryDir,
  memoryPrompt,
  profilePath,
  readLog,
  readMemory,
  readProfile,
  writeLog,
  writeMemory,
  writeProfile,
} from "./desk.ts";
import { COS_PROMPT, withCosPrompt } from "./roles.ts";

const BOT = "bot-mem-1";

describe("desk memory profile+log", () => {
  beforeEach(() => {
    rmSync(join(DATA_DIR, "memory"), { recursive: true, force: true });
    rmSync(join(DATA_DIR, "desk"), { recursive: true, force: true });
  });

  it("migrates ~/.nexbot/memory/<id>.md into profile.md and unlinks the old file", () => {
    mkdirSync(join(DATA_DIR, "memory"), { recursive: true });
    const oldFile = join(DATA_DIR, "memory", `${BOT}.md`);
    writeFileSync(oldFile, "Owner: Charles");
    ensureMemory(BOT);
    expect(existsSync(oldFile)).toBe(false);
    expect(readProfile(BOT)).toBe("Owner: Charles");
    expect(existsSync(profilePath(BOT))).toBe(true);
  });

  it("does not migrate when the old path is a directory", () => {
    const oldDir = join(DATA_DIR, "memory", `${BOT}.md`);
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "keep.txt"), "stay");
    ensureMemory(BOT);
    expect(existsSync(oldDir)).toBe(true);
    expect(readFileSync(join(oldDir, "keep.txt"), "utf8")).toBe("stay");
    expect(readProfile(BOT)).toBe("");
  });

  it("reads and writes profile and month log separately", () => {
    const when = new Date(2026, 7, 13); // local Aug 2026
    writeProfile(BOT, "facts");
    writeLog(BOT, "august note", when);
    expect(readProfile(BOT)).toBe("facts");
    expect(readLog(BOT, when)).toBe("august note");
    appendLog(BOT, "\nmore", when);
    expect(readLog(BOT, when)).toBe("august note\nmore");
    expect(logPath(BOT, when)).toContain(join("log", "2026-08.md"));
  });

  it("readMemory concatenates profile and current log; writeMemory writes profile only", () => {
    writeProfile(BOT, "p");
    writeLog(BOT, "l");
    expect(readMemory(BOT)).toBe("p\n\nl");
    writeMemory(BOT, "only-profile");
    expect(readProfile(BOT)).toBe("only-profile");
    expect(readLog(BOT)).toBe("l");
  });

  it("memoryPrompt is empty when both files are empty", () => {
    ensureMemory(BOT);
    expect(memoryPrompt(BOT)).toBe("");
  });

  it("memoryPrompt includes absolute paths and trims the log to last 8k", () => {
    writeProfile(BOT, "durable");
    writeLog(BOT, "x".repeat(9000));
    const prompt = memoryPrompt(BOT);
    expect(prompt).toContain(profilePath(BOT));
    expect(prompt).toContain(logPath(BOT));
    expect(prompt).toContain("durable");
    expect(prompt).toContain("x".repeat(8000));
    expect(prompt.includes("x".repeat(8001))).toBe(false);
  });

  it("memoryPrompt also clips a huge profile", () => {
    writeProfile(BOT, "P".repeat(9000));
    writeLog(BOT, "note");
    const prompt = memoryPrompt(BOT);
    expect(prompt).toContain("P".repeat(8000));
    expect(prompt.includes("P".repeat(8001))).toBe(false);
    expect(prompt).toContain("note");
  });

  it("existsMemory is true for profile or any log file", () => {
    expect(existsMemory(BOT)).toBe(false);
    writeProfile(BOT, "p");
    expect(existsMemory(BOT)).toBe(true);
    rmSync(memoryDir(BOT), { recursive: true, force: true });
    expect(existsMemory(BOT)).toBe(false);
    writeLog(BOT, "note");
    expect(existsMemory(BOT)).toBe(true);
  });

  it("ensureDesk also creates the memory folder", () => {
    const desk = ensureDesk(BOT);
    expect(desk).toBe(deskPath(BOT));
    expect(existsSync(join(desk, "inbox"))).toBe(true);
    expect(existsSync(join(memoryDir(BOT), "log"))).toBe(true);
  });

  it("buildPersona includes memory when memoryEnabled supplies a non-empty prompt", () => {
    writeProfile(BOT, "Owner: Charles");
    const memory = memoryPrompt(BOT);
    expect(memory.length).toBeGreaterThan(0);
    expect(memory).toContain("Owner: Charles");
    const enabled = buildPersona({ name: "Luna", title: "Manages the desk" }, { desk: "DESK", memory, skills: "" });
    expect(enabled).toContain("You are Luna");
    expect(enabled).toContain("Owner: Charles");
    expect(enabled).toContain(memory);
    const disabled = buildPersona({ name: "Luna" }, { desk: "DESK", memory: "", skills: "" });
    expect(disabled).not.toContain("Owner: Charles");
    const routed = withCosPrompt({ name: "Luna", title: "Chief of Staff" }, enabled);
    expect(routed).toContain(COS_PROMPT);
    expect(routed).toContain("Never ask_bot X to write the critique of itself");
    expect(withCosPrompt({ name: "Research" }, enabled)).toBe(enabled);
  });
});
