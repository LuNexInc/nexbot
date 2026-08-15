import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/types";
import { buildRoutingMessage, getClarificationChoices, shouldAskClarification } from "./clarification";

function bot(id: string, name: string, title: string, description: string): Bot {
  return {
    id,
    threadId: `thread-${id}`,
    name,
    title,
    description,
    notifications: true,
    color: "teal",
    unread: false,
    modelSelection: { instanceId: "test", model: "test" },
    messages: [],
  };
}

describe("clarification routing", () => {
  const chief = bot("chief", "Chief of Staff", "Chief of Staff", "Routes work to the right teammate.");
  const roster = [
    chief,
    bot("research", "Research", "Research & briefings", "Find sources and summarize them."),
    bot("spark", "Spark", "Ideas & creative work", "Shape ideas into clear drafts."),
    bot("builder", "Builder", "Projects & builds", "Turn projects into concrete files."),
  ];

  it("gates vague action requests from Chief of Staff", () => {
    expect(shouldAskClarification("Can you help me with this?", chief)).toBe(true);
    expect(shouldAskClarification("Research the current market", chief)).toBe(false);
    expect(shouldAskClarification("Can you help me?", roster[1])).toBe(false);
  });

  it("offers up to three likely teammates", () => {
    const choices = getClarificationChoices("Can you help me with this?", roster, chief.id);
    expect(choices.map((choice) => choice.bot.name)).toEqual(["Research", "Spark", "Builder"]);
  });

  it("uses a real mention when the user confirms a teammate", () => {
    expect(buildRoutingMessage("Can you help me with this?", roster[1])).toBe("@Research Can you help me with this?");
    expect(buildRoutingMessage("Can you help me with this?")).toBe("Can you help me with this?");
  });
});
