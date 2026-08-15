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

  it("uses the thinking motion when a bot starts a turn", () => {
    const state = {
      ...initialState,
      bots: [bot({ id: "known", busy: false })],
    };
    const next = reducer(state, {
      type: "botPatched",
      bot: { id: "known", busy: true },
    });
    expect(next.mascotMotion).toMatchObject({ botId: "known", kind: "thinking" });
  });
});

describe("expert mode", () => {
  it("toggles execution details without changing the rest of the state", () => {
    const state = { ...initialState, selectedId: "b1" };
    const next = reducer(state, { type: "setExpertMode", enabled: false });
    expect(next.expertMode).toBe(false);
    expect(next.selectedId).toBe("b1");
    expect(reducer(next, { type: "setExpertMode", enabled: true }).expertMode).toBe(true);
  });
});


describe("optimistic send and nonce reconcile", () => {
  it("send appends a pending user message", () => {
    const state = {
      ...initialState,
      bots: [bot({ id: "b1", threadId: "t1" })],
    };
    const next = reducer(state, {
      type: "send",
      botId: "b1",
      text: "hello",
      clientNonce: "n1",
    });
    expect(next.bots[0].messages).toHaveLength(1);
    expect(next.bots[0].messages[0]).toMatchObject({
      id: "optimistic:n1",
      role: "user",
      kind: "text",
      text: "hello",
      status: "pending",
      clientNonce: "n1",
    });
  });

  it("messageAdded with matching clientNonce replaces pending and does not duplicate", () => {
    let state = {
      ...initialState,
      bots: [bot({ id: "b1", threadId: "t1" })],
    };
    state = reducer(state, { type: "send", botId: "b1", text: "hello", clientNonce: "n1" });
    const confirmed: Message = {
      id: "server-1",
      role: "user",
      kind: "text",
      text: "hello",
      at: 99,
      clientNonce: "n1",
    };
    const next = reducer(state, { type: "messageAdded", threadId: "t1", message: confirmed });
    expect(next.bots[0].messages).toHaveLength(1);
    expect(next.bots[0].messages[0].id).toBe("server-1");
    expect(next.bots[0].messages[0].status).toBe("confirmed");
    expect(next.bots[0].messages[0].clientNonce).toBe("n1");
  });

  it("messageFailed marks the optimistic row failed", () => {
    let state = {
      ...initialState,
      bots: [bot({ id: "b1", threadId: "t1" })],
    };
    state = reducer(state, { type: "send", botId: "b1", text: "hello", clientNonce: "n1" });
    const next = reducer(state, { type: "messageFailed", threadId: "t1", clientNonce: "n1" });
    expect(next.bots[0].messages).toHaveLength(1);
    expect(next.bots[0].messages[0].status).toBe("failed");
  });

  it("uses the handover motion for a teammate message", () => {
    const state = {
      ...initialState,
      bots: [bot({ id: "b1", threadId: "t1" })],
    };
    const next = reducer(state, {
      type: "messageAdded",
      threadId: "t1",
      message: {
        id: "handover-1",
        role: "user",
        kind: "text",
        text: "Here is the result.",
        fromBot: { id: "b2", name: "Research" },
        at: 2,
      },
    });
    expect(next.mascotMotion).toMatchObject({ botId: "b1", kind: "handover" });
  });
});

describe("todosUpdated", () => {
  it("sets the live checklist on the bot", () => {
    const state = {
      ...initialState,
      bots: [bot({ id: "spec", name: "Research" })],
    };
    const items = [{ id: "td-1", content: "Draft", status: "in_progress" as const }];
    const next = reducer(state, { type: "todosUpdated", botId: "spec", items });
    expect(next.bots[0].todos).toEqual(items);
  });
});

describe("bot-scoped runtime warnings", () => {
  it("keeps one bot's warning out of another bot's chat", () => {
    const state = {
      ...initialState,
      selectedId: "hands",
      bots: [bot({ id: "hands" }), bot({ id: "luna" })],
    };
    const warned = reducer(state, { type: "botError", botId: "luna", message: "Luna stalled" });
    expect(warned.botErrors).toEqual({ luna: "Luna stalled" });
    expect(warned.error).toBeNull();
    const cleared = reducer(warned, { type: "clearBotError", botId: "luna" });
    expect(cleared.botErrors).toEqual({});
  });
});
