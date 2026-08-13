import { describe, expect, it } from "vitest";
import { COS_PROMPT, isForbiddenSelfFight, isForbiddenFightAsk } from "./roles.ts";

describe("isForbiddenSelfFight", () => {
  const research = { name: "Research", title: "Research" };
  const rebuttal = { name: "Rebuttal", title: "Critic" };
  const critic = { name: "Critic", title: "Critic" };
  const specialist = { name: "Specialist", title: "Specialist" };
  const cos = { name: "Luna", title: "Chief of Staff" };
  const fightMsg =
    "fight Research. Have Critic critique Research's existing sourced briefing only. Work stays in Critic's chat. Do not ask Research to write a new brief.";

  it("blocks a fighter asking the target to do the job", () => {
    expect(
      isForbiddenSelfFight(
        { name: "Rebuttal", title: "Challenge Research", description: "" },
        research,
        "Write a sourced brief ranking risks",
      ),
    ).toBe(true);
  });
  it("allows CoS to ask Research for a normal brief", () => {
    expect(
      isForbiddenSelfFight(
        { name: "Luna", title: "Chief of Staff", description: "routes" },
        research,
        "Summarize today's X-watch 9s",
      ),
    ).toBe(false);
  });
  it("blocks fight Research sent to Research", () => {
    expect(isForbiddenFightAsk(cos, research, "fight Research")).toBe(true);
  });
  it("blocks asking Research to write the brief being fought", () => {
    expect(
      isForbiddenFightAsk(
        { name: "Rebuttal", title: "Critic" },
        research,
        "ask Research to write a brief then challenge it",
      ),
    ).toBe(true);
  });
  it("blocks ask Research to write a new sourced brief then challenge it", () => {
    expect(
      isForbiddenFightAsk(cos, research, "ask Research to write a new sourced brief then challenge it"),
    ).toBe(true);
  });
  it("allows fight Research sent to the critic", () => {
    expect(isForbiddenFightAsk(cos, rebuttal, "fight Research")).toBe(false);
  });
  it("allows fight Research + ask Critic even when the text names Critic", () => {
    expect(isForbiddenFightAsk(cos, critic, "fight Research")).toBe(false);
    expect(isForbiddenFightAsk(cos, critic, fightMsg)).toBe(false);
    expect(isForbiddenFightAsk(cos, rebuttal, fightMsg)).toBe(false);
  });
  it("blocks fight Research + ask Research even when Critic is also named", () => {
    expect(isForbiddenFightAsk(cos, research, fightMsg)).toBe(true);
  });
  it("allows benign Critic to Specialist hi", () => {
    expect(isForbiddenFightAsk(critic, specialist, "hi")).toBe(false);
  });
});

describe("COS_PROMPT", () => {
  it("bans process environ harvest and requires an ask_bot summary", () => {
    expect(COS_PROMPT).toMatch(/\/proc/);
    expect(COS_PROMPT).toMatch(/environ/);
    expect(COS_PROMPT).toMatch(/COMMS_TOKEN/);
    expect(COS_PROMPT).toMatch(/x-nexbot-secret/);
    expect(COS_PROMPT).toMatch(/scavenged tokens/);
    expect(COS_PROMPT).toMatch(/After ask_bot returns/);
    expect(COS_PROMPT).toMatch(/Never ask_bot X to write the critique of itself/);
    expect(COS_PROMPT).toMatch(/contractions/);
    expect(COS_PROMPT).toMatch(/Don.t dump the roster unprompted/);
  });
});
