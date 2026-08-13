import { describe, expect, it } from "vitest";
import { initialState, reducer } from "./reducer";
import type { Bot, Message } from "./types";

function bot(partial: Partial<Bot> & { id: string }): Bot {
  return {
    threadId: partial.id,
    name: "New Bot",
    title: "",
    description: "",
    notifications: true,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "grok", model: "grok-4.5" },
    messages: [],
    ...partial,
  };
}

describe("botPatched", () => {
  it("upserts an unknown id without changing selectedId", () => {
    const state = {
      ...initialState,
      selectedId: "cos",
      bots: [bot({ id: "cos", name: "Chief of Staff" })],
    };
    const next = reducer(state, {
      type: "botPatched",
      bot: { id: "new-1", name: "Researcher" },
    });
    expect(next.bots[0].id).toBe("new-1");
    expect(next.bots[0].name).toBe("Researcher");
    expect(next.selectedId).toBe("cos");
  });

  it("patches a known id and keeps messages", () => {
    const messages: Message[] = [
      { id: "m1", role: "user", kind: "text", text: "hi", at: 1 },
    ];
    const state = {
      ...initialState,
      selectedId: "known",
      bots: [bot({ id: "known", name: "Old Name", messages })],
    };
    const next = reducer(state, {
      type: "botPatched",
      bot: { id: "known", name: "New Name" },
    });
    expect(next.bots[0].name).toBe("New Name");
    expect(next.bots[0].messages).toEqual(messages);
    expect(next.bots).toHaveLength(1);
  });
});
