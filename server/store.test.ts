// Store persistence contract: bots.json + messages-<threadId>.json are
// the durable record — everything here must survive a process restart
// except `busy`, which never does (no turn survives one either).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store, mentionedBots, teamSeedMatches, isChiefOfStaffName, uniqueCosIdentity, handoffThreadIds, findChiefOfStaffBot, clipForTurn, TRANSCRIPT_WINDOW, TRANSCRIPT_TEXT_CAP, type BotRecord } from "./store.ts";
import { ROLE_CARD_OPTIONS } from "./roles.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("Store", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("createBot seeds a greeting and an onboarding card", () => {
    const store = new Store(selection);
    const bot = store.createBot();

    const messages = store.messagesFor(bot.threadId);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "bot", kind: "text" });
    expect(messages[1].kind).toBe("options");
    expect(messages[1].card?.options.length).toBeGreaterThan(1);
    expect(bot.modelSelection).toEqual(selection());
  });

  it("rotates colors across created bots", () => {
    const store = new Store(selection);
    const first = store.createBot();
    const second = store.createBot();
    expect(first.color).not.toBe(second.color);
  });

  it("persists bots and transcripts across a restart, but not busy", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    store.patchBot(bot.id, { name: "Testy", busy: true });
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "hi there" });

    const reloaded = new Store(selection);
    const back = reloaded.bot(bot.id)!;
    expect(back.name).toBe("Testy");
    expect(back.busy).toBe(false);
    expect(reloaded.messagesFor(bot.threadId).some((m) => m.text === "hi there")).toBe(true);
    expect(existsSync(join(DATA_DIR, `messages-${bot.threadId}.json`))).toBe(true);
  });

  it("patchMessage merges card patches and returns null for unknown ids", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const card = store.messagesFor(bot.threadId)[1];

    const patched = store.patchMessage(bot.threadId, card.id, {
      card: { ...card.card!, answered: "Work & projects" },
    });
    expect(patched?.card?.answered).toBe("Work & projects");
    expect(store.patchMessage(bot.threadId, "nope", {})).toBeNull();
  });

  it("deleteBot removes the bot and its transcript file", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const file = join(DATA_DIR, `messages-${bot.threadId}.json`);
    expect(existsSync(file)).toBe(true);

    expect(store.deleteBot(bot.id)).toBe(true);
    expect(store.bot(bot.id)).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(store.deleteBot(bot.id)).toBe(false);
  });

  it("setResumeCursor is a no-op (history off)", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    store.setResumeCursor(bot.id, "claude", "sess-abc");
    store.setResumeCursor(bot.id, "codex", "thread-xyz");

    expect(store.bot(bot.id)?.resumeCursors).toEqual({});
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.resumeCursors).toEqual({});
  });

  it("createBot with a job name writes a teammate greeting", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Forge", title: "Work & projects" });
    const hello = store.messagesFor(bot.threadId)[0];
    expect(hello.text).toContain("Forge");
    expect(hello.text).toContain("Work & projects");
    expect(hello.text).toContain("sleeps");
  });

  it("createBot as a group has no job card and caps members at 6", () => {
    const store = new Store(selection);
    const a = store.createBot({ name: "A" });
    const group = store.createBot({
      kind: "group",
      name: "War room",
      memberIds: [a.id, "b", "c", "d", "e", "f", "g"],
    });
    expect(group.kind).toBe("group");
    expect(group.memberIds).toHaveLength(6);
    expect(store.messagesFor(group.threadId)).toHaveLength(1);
    expect(store.messagesFor(group.threadId)[0].kind).toBe("text");
  });

  it("seedIfEmpty creates Chief of Staff + Research, once", () => {
    const store = new Store(selection);
    store.seedIfEmpty();
    expect(store.bots.map((b) => b.name)).toEqual(["Chief of Staff", "Research"]);
    expect(store.bots.every((b) => b.memoryEnabled)).toBe(true);
    store.seedIfEmpty();
    expect(store.bots).toHaveLength(2);

    const reloaded = new Store(selection);
    reloaded.seedIfEmpty();
    expect(reloaded.bots).toHaveLength(2);
  });

  it("ensureTeamSeeds treats Luna as Chief of Staff and does not duplicate CoS", () => {
    const store = new Store(selection);
    store.createBot({ name: "Luna", title: "Night shift" });
    store.ensureTeamSeeds();
    expect(store.bots.some((b) => b.name === "Luna")).toBe(true);
    expect(store.bots.some((b) => b.name === "Chief of Staff")).toBe(false);
    expect(store.bots.some((b) => b.name === "Research")).toBe(true);
  });

  it("ensureTeamSeeds does not duplicate Research", () => {
    const store = new Store(selection);
    store.createBot({ name: "Research", title: "Research & briefings", color: "blue" });
    store.ensureTeamSeeds();
    expect(store.bots.filter((b) => b.name.toLowerCase() === "research")).toHaveLength(1);
    expect(store.bots.some((b) => b.name === "Chief of Staff")).toBe(true);
  });

  it("second ensureTeamSeeds does not add dupes", () => {
    const store = new Store(selection);
    store.ensureTeamSeeds();
    const n = store.bots.length;
    store.ensureTeamSeeds();
    expect(store.bots).toHaveLength(n);
    expect(store.bots.filter((b) => b.name === "Chief of Staff")).toHaveLength(1);
    expect(store.bots.filter((b) => b.name === "Research")).toHaveLength(1);
  });

  it("ensureTeamSeeds still seeds CoS when a group tried to take the name", () => {
    const store = new Store(selection);
    const a = store.createBot({ name: "A" });
    const b = store.createBot({ name: "B" });
    const group = store.createBot({ kind: "group", name: "Chief of Staff", memberIds: [a.id, b.id] });
    expect(group.name).toBe("Specialist");
    store.ensureTeamSeeds();
    const named = store.bots.filter((x) => x.name === "Chief of Staff");
    expect(named).toHaveLength(1);
    expect(named[0].kind).not.toBe("group");
    expect(named[0].memoryEnabled).toBe(true);
  });

  it("tolerates a corrupt bots.json by starting empty", () => {
    const store = new Store(selection);
    store.createBot();
    writeFileSync(join(DATA_DIR, "bots.json"), "{not json");

    const reloaded = new Store(selection);
    expect(reloaded.bots).toEqual([]);
  });

  it("busy is wiped even when bots.json says otherwise", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const raw: BotRecord[] = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
    raw.find((b) => b.id === bot.id)!.busy = true;
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify(raw));

    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.busy).toBe(false);
  });

  it("persists unread across a restart, but not busy", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    store.patchBot(bot.id, { unread: true, busy: true });

    const reloaded = new Store(selection);
    const back = reloaded.bot(bot.id)!;
    expect(back.unread).toBe(true);
    expect(back.busy).toBe(false);
  });

  it("ensureTeamSeeds adds Chief of Staff and Research when missing", () => {
    const store = new Store(selection);
    store.ensureTeamSeeds();
    const names = store.bots.filter((b) => b.kind !== "group").map((b) => b.name);
    expect(names).toContain("Chief of Staff");
    expect(names).toContain("Research");
    expect(store.bots.find((b) => b.name === "Chief of Staff")?.memoryEnabled).toBe(true);
    expect(store.bots.find((b) => b.name === "Research")?.memoryEnabled).toBe(true);
  });

  it("ensureTeamSeeds does not wipe existing bots or duplicate", () => {
    const store = new Store(selection);
    const custom = store.createBot({ name: "Custom" });
    store.ensureTeamSeeds();
    expect(store.bot(custom.id)?.name).toBe("Custom");
    expect(store.bots.filter((b) => b.name === "Chief of Staff")).toHaveLength(1);
    expect(store.bots.filter((b) => b.name === "Research")).toHaveLength(1);
    store.ensureTeamSeeds();
    expect(store.bots.filter((b) => b.name === "Chief of Staff")).toHaveLength(1);
    expect(store.bots.filter((b) => b.name === "Research")).toHaveLength(1);
    expect(store.bot(custom.id)).toBeTruthy();
  });

  it("persists enabledSkillSlugs including null", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    expect(bot.enabledSkillSlugs).toBeUndefined();
    store.patchBot(bot.id, { enabledSkillSlugs: ["alpha"] });
    let reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.enabledSkillSlugs).toEqual(["alpha"]);
    store.patchBot(bot.id, { enabledSkillSlugs: null });
    reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.enabledSkillSlugs).toBeNull();
  });
});

describe("one Chief of Staff", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("ROLE_CARD_OPTIONS never offers Chief of Staff as a new-bot job", () => {
    expect(ROLE_CARD_OPTIONS.some((t) => t.toLowerCase().includes("chief of staff"))).toBe(false);
  });

  it("createBot renames a second CoS to Specialist", () => {
    const store = new Store(selection);
    const luna = store.createBot({ name: "Luna", title: "Chief of Staff" });
    const dupe = store.createBot({ name: "Chief of Staff", title: "Chief of Staff" });
    expect(luna.name).toBe("Luna");
    expect(dupe.name).toBe("Specialist");
    expect(dupe.title).toBe("Specialist");
    expect(store.bots.filter((b) => isChiefOfStaffName(b.name, b.title))).toHaveLength(1);
  });

  it("createBot keeps a specialist name when only the title would duplicate CoS", () => {
    const store = new Store(selection);
    store.createBot({ name: "Luna", title: "Chief of Staff" });
    const other = store.createBot({ name: "Rebuttal", title: "Deputy Chief of Staff" });
    expect(other.name).toBe("Rebuttal");
    expect(other.title).toBe("Specialist");
  });

  it("ensureTeamSeeds skips CoS when a bot already has that title", () => {
    const store = new Store(selection);
    store.createBot({ name: "Pat", title: "Night Chief of Staff" });
    store.ensureTeamSeeds();
    expect(store.bots.filter((b) => b.kind !== "group" && isChiefOfStaffName(b.name, b.title))).toHaveLength(1);
    expect(store.bots.some((b) => b.name === "Chief of Staff")).toBe(false);
    expect(store.bots.some((b) => b.name === "Research")).toBe(true);
  });

  it("groups named Chief of Staff are demoted and do not fill the CoS seat", () => {
    const store = new Store(selection);
    const a = store.createBot({ name: "A" });
    const b = store.createBot({ name: "B" });
    const group = store.createBot({ kind: "group", name: "Chief of Staff", memberIds: [a.id, b.id] });
    expect(group.name).toBe("Specialist");
    expect(store.hasChiefOfStaff()).toBe(false);
  });

  it("patchBot cannot rename a group onto the CoS identity", () => {
    const store = new Store(selection);
    store.createBot({ name: "Luna", title: "Chief of Staff" });
    const a = store.createBot({ name: "A" });
    const b = store.createBot({ name: "B" });
    const group = store.createBot({ kind: "group", name: "War room", memberIds: [a.id, b.id] });
    store.patchBot(group.id, { name: "Chief of Staff" });
    expect(store.bot(group.id)?.name).toBe("Specialist");
    store.patchBot(group.id, { name: "Luna" });
    expect(store.bot(group.id)?.name).toBe("Specialist");
    expect(store.bots.filter((x) => isChiefOfStaffName(x.name, x.title))).toHaveLength(1);
  });

  it("deleteBot refuses the last Chief of Staff and still deletes specialists", () => {
    const store = new Store(selection);
    const luna = store.createBot({ name: "Luna", title: "Chief of Staff" });
    const spec = store.createBot({ name: "Forge", title: "Work & projects" });
    expect(store.isLastChiefOfStaff(luna.id)).toBe(true);
    expect(store.deleteBot(luna.id)).toBe(false);
    expect(store.bot(luna.id)?.name).toBe("Luna");
    expect(store.deleteBot(spec.id)).toBe(true);
    expect(store.bot(spec.id)).toBeNull();
  });

  it("patchBot description-only does not mint a second CoS", () => {
    const store = new Store(selection);
    store.createBot({ name: "Luna", title: "Chief of Staff" });
    const spec = store.createBot({ name: "Forge", title: "Work & projects" });
    store.patchBot(spec.id, { description: "Chief of Staff" });
    expect(store.bot(spec.id)?.name).toBe("Forge");
    expect(store.bot(spec.id)?.title).toBe("Work & projects");
    expect(isChiefOfStaffName(spec.name, spec.title)).toBe(false);
    expect(store.bots.filter((b) => isChiefOfStaffName(b.name, b.title))).toHaveLength(1);
  });

  it("patchBot cannot turn a specialist into a second CoS", () => {
    const store = new Store(selection);
    const luna = store.createBot({ name: "Luna", title: "Chief of Staff" });
    const spec = store.createBot({ name: "Research", title: "Research & briefings" });

    store.patchBot(spec.id, { name: "Chief of Staff", title: "Chief of Staff" });
    expect(store.bot(spec.id)?.name).toBe("Specialist");
    expect(store.bot(spec.id)?.title).toBe("Specialist");
    expect(store.bot(luna.id)?.name).toBe("Luna");
    expect(store.bots.filter((b) => isChiefOfStaffName(b.name, b.title))).toHaveLength(1);

    store.patchBot(spec.id, { name: "Luna" });
    expect(store.bot(spec.id)?.name).toBe("Specialist");

    store.patchBot(spec.id, { title: "Deputy Chief of Staff" });
    expect(store.bot(spec.id)?.title).toBe("Specialist");
    expect(store.bots.filter((b) => isChiefOfStaffName(b.name, b.title))).toHaveLength(1);
  });

  it("patchBot still allows editing the existing CoS", () => {
    const store = new Store(selection);
    const luna = store.createBot({ name: "Luna", title: "Chief of Staff" });
    store.patchBot(luna.id, { title: "Chief of Staff", description: "routes" });
    expect(store.bot(luna.id)?.name).toBe("Luna");
    expect(store.bot(luna.id)?.title).toBe("Chief of Staff");
    expect(store.bot(luna.id)?.description).toBe("routes");
  });

  it("uniqueCosIdentity demotes only when a CoS already exists", () => {
    expect(uniqueCosIdentity("Luna", "Chief of Staff", false)).toEqual({
      name: "Luna",
      title: "Chief of Staff",
    });
    expect(uniqueCosIdentity("Chief of Staff", "Chief of Staff", true)).toEqual({
      name: "Specialist",
      title: "Specialist",
    });
    expect(uniqueCosIdentity("Rebuttal", "Deputy Chief of Staff", true)).toEqual({
      name: "Rebuttal",
      title: "Specialist",
    });
  });
});

describe("mentionedBots", () => {

  const peers = [
    { id: "1", name: "New Bot" },
    { id: "2", name: "New Bot 2" },
    { id: "3", name: "Research" },
    { id: "4", name: "Ghost", hidden: true },
  ];
  it("fans out @Name case-insensitively", () => {
    expect(mentionedBots("hey @research look this up", peers).map((b) => b.id)).toEqual(["3"]);
  });
  it("ignores user@host emails", () => {
    expect(mentionedBots("mail charles@nexbot.dev please", peers)).toEqual([]);
  });
  it("longest name wins so prefixes never half-match", () => {
    expect(mentionedBots("ask @New Bot 2 about it", peers).map((b) => b.id)).toEqual(["2"]);
  });
});

describe("teamSeedMatches / Luna as CoS", () => {
  it("matches exact names case-insensitively", () => {
    expect(teamSeedMatches("Research", "research")).toBe(true);
    expect(teamSeedMatches("Forge", "Research")).toBe(false);
  });
  it("treats Luna as already being Chief of Staff", () => {
    expect(isChiefOfStaffName("Luna")).toBe(true);
    expect(isChiefOfStaffName("chief of staff")).toBe(true);
    expect(isChiefOfStaffName("Pat", "Acting Chief of Staff")).toBe(true);
    expect(isChiefOfStaffName("Forge", "Work & projects")).toBe(false);
    expect(teamSeedMatches("Luna", "Chief of Staff")).toBe(true);
    expect(teamSeedMatches("Luna", "Research")).toBe(false);
  });
});

describe("handoffThreadIds", () => {
  const luna = { id: "luna", threadId: "t-luna", name: "Luna" };
  const research = { id: "res", threadId: "t-res", name: "Research" };
  const forge = { id: "forge", threadId: "t-forge", name: "Forge" };
  const cos = { id: "cos", threadId: "t-cos", name: "Chief of Staff" };

  it("copies to sender, recipient, and CoS when CoS is someone else", () => {
    expect(handoffThreadIds({ from: forge, to: research, bots: [forge, research, cos] }).sort()).toEqual(
      ["t-cos", "t-forge", "t-res"],
    );
  });

  it("treats Luna as CoS", () => {
    expect(handoffThreadIds({ from: forge, to: research, bots: [forge, research, luna] }).sort()).toEqual(
      ["t-forge", "t-luna", "t-res"],
    );
  });

  it("does not duplicate CoS when Luna is the sender", () => {
    expect(handoffThreadIds({ from: luna, to: research, bots: [luna, research] }).sort()).toEqual(
      ["t-luna", "t-res"],
    );
  });

  it("does not duplicate CoS when CoS is the recipient", () => {
    expect(handoffThreadIds({ from: forge, to: luna, bots: [forge, luna, research] }).sort()).toEqual(
      ["t-forge", "t-luna"],
    );
  });

  it("from user (null) skips sender and still copies recipient + CoS", () => {
    expect(handoffThreadIds({ from: null, to: research, bots: [forge, research, luna] }).sort()).toEqual(
      ["t-luna", "t-res"],
    );
  });

  it("prefers Luna over a bot named Chief of Staff when both exist", () => {
    expect(findChiefOfStaffBot([luna, cos, research])?.id).toBe("luna");
  });

  it("matches CoS by title containing chief of staff", () => {
    const pat = { id: "pat", threadId: "t-pat", name: "Pat", title: "Acting Chief of Staff" };
    expect(findChiefOfStaffBot([research, pat])?.id).toBe("pat");
  });
});

describe("clipForTurn", () => {
  it("keeps the last-30 window and caps each message text", () => {
    const huge = "x".repeat(TRANSCRIPT_TEXT_CAP + 50);
    const msgs = Array.from({ length: TRANSCRIPT_WINDOW + 5 }, (_, i) => ({
      kind: "text" as const,
      role: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
      text: i === TRANSCRIPT_WINDOW + 4 ? huge : `m${i}`,
    }));
    const clipped = clipForTurn(msgs);
    expect(clipped).toHaveLength(TRANSCRIPT_WINDOW);
    expect(clipped[0].text).toBe("m5");
    expect(clipped[clipped.length - 1].text).toHaveLength(TRANSCRIPT_TEXT_CAP);
    expect(clipped[clipped.length - 1].text.startsWith("x")).toBe(true);
  });
  it("maps fromBot user rows to assistant and skips non-text", () => {
    const clipped = clipForTurn([
      { kind: "activity", role: "bot", text: "tool" },
      { kind: "text", role: "user", text: "hi", fromBot: { id: "x", name: "X" } },
      { kind: "text", role: "user", text: "  " },
      { kind: "text", role: "user", text: "real" },
    ]);
    expect(clipped).toEqual([
      { role: "assistant", text: "hi" },
      { role: "user", text: "real" },
    ]);
  });
});
