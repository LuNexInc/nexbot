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

describe("hydrate and selection", () => {
  it("orders the Chief of Staff first and keeps the selected chat", () => {
    const state = { ...initialState, selectedId: "chosen", bots: [bot({ id: "c" })] };
    const next = reducer(state, {
      type: "hydrate",
      bots: [bot({ id: "a", name: "Engineer" }), bot({ id: "cos", name: "Chief of Staff" }), bot({ id: "chosen", name: "Chosen" })],
    });
    expect(next.bots[0].id).toBe("cos");
    expect(next.selectedId).toBe("chosen");
    expect(next.rosterError).toBeNull();
  });

  it("auto-selects the Chief of Staff when nothing is selected", () => {
    const next = reducer(initialState, {
      type: "hydrate",
      bots: [bot({ id: "a" }), bot({ id: "cos", name: "Chief of Staff" })],
    });
    expect(next.selectedId).toBe("cos");
  });

  it("select clears the row unread and switches", () => {
    const next = reducer({ ...initialState, bots: [bot({ id: "b1", unread: true })] }, { type: "select", id: "b1" });
    expect(next.selectedId).toBe("b1");
    expect(next.bots[0].unread).toBe(false);
  });

  it("deleteBot falls back to the next bot and clears its error", () => {
    const next = reducer(
      { ...initialState, selectedId: "b1", bots: [bot({ id: "b1" }), bot({ id: "b2" })], botErrors: { b1: "boom" } },
      { type: "deleteBot", botId: "b1" },
    );
    expect(next.bots.map((b) => b.id)).toEqual(["b2"]);
    expect(next.selectedId).toBe("b2");
    expect(next.botErrors).toEqual({});
  });
});

describe("botAdded and option cards", () => {
  it("botAdded prepends and selects the new bot", () => {
    const next = reducer({ ...initialState, bots: [bot({ id: "b1" })] }, { type: "botAdded", bot: bot({ id: "b2", name: "New" }) });
    expect(next.bots[0].id).toBe("b2");
    expect(next.selectedId).toBe("b2");
  });

  it("answerCard settles an option card optimistically", () => {
    const card: Message = { id: "card1", role: "bot", kind: "options", at: 1, card: { title: "T", subtitle: "S", options: ["a"] } };
    const next = reducer({ ...initialState, bots: [bot({ id: "b1", messages: [card] })] }, { type: "answerCard", botId: "b1", messageId: "card1", answer: "a" });
    expect(next.bots[0].messages[0].card?.answered).toBe("a");
  });

  it("dismissCard hides an option card", () => {
    const card: Message = { id: "card1", role: "bot", kind: "options", at: 1, card: { title: "T", subtitle: "S", options: ["a"] } };
    const next = reducer({ ...initialState, bots: [bot({ id: "b1", messages: [card] })] }, { type: "dismissCard", botId: "b1", messageId: "card1" });
    expect(next.bots[0].messages[0].card?.dismissed).toBe(true);
  });
});

describe("messagePatched and messagesPrepended", () => {
  it("messagePatched replaces a known message by id", () => {
    const state = { ...initialState, bots: [bot({ id: "b1", threadId: "t1", messages: [{ id: "m1", role: "bot", kind: "text", text: "old", at: 1 }] })] };
    const next = reducer(state, { type: "messagePatched", threadId: "t1", message: { id: "m1", role: "bot", kind: "text", text: "new", at: 1 } });
    expect(next.bots[0].messages[0].text).toBe("new");
  });

  it("messagesPrepended dedups by id and tracks earlier history", () => {
    const state = { ...initialState, bots: [bot({ id: "b1", threadId: "t1", messages: [{ id: "m2", role: "bot", kind: "text", at: 2 }] })] };
    const next = reducer(state, {
      type: "messagesPrepended",
      threadId: "t1",
      messages: [{ id: "m0", role: "bot", kind: "text", at: 1 }, { id: "m2" as string, role: "bot", kind: "text", at: 2 }],
      messageCount: 10,
      hasEarlier: true,
    });
    expect(next.bots[0].messages.map((m) => m.id)).toEqual(["m0", "m2"]);
    expect(next.bots[0].messageCount).toBe(10);
    expect(next.bots[0].hasEarlier).toBe(true);
  });
});

describe("streaming, screen, and panels", () => {
  it("streamDelta and streamClear manage in-flight text", () => {
    let s = reducer(initialState, { type: "streamDelta", threadId: "t1", delta: "hello" });
    s = reducer(s, { type: "streamDelta", threadId: "t1", delta: " world" });
    expect(s.streaming.t1).toBe("hello world");
    s = reducer(s, { type: "reasoningDelta", threadId: "t1", delta: "why" });
    expect(s.streamingReasoning.t1).toBe("why");
    s = reducer(s, { type: "streamClear", threadId: "t1" });
    expect(s.streaming.t1).toBeUndefined();
    expect(s.streamingReasoning.t1).toBeUndefined();
  });

  it("screenFrame records the screenshot and lifts provisioning", () => {
    const next = reducer(
      { ...initialState, bots: [bot({ id: "b1" })], provisioning: { b1: true } },
      { type: "screenFrame", botId: "b1", png: "data:image/png;base64,x", mime: "image/png" },
    );
    expect(next.screens.b1?.png).toBe("data:image/png;base64,x");
    expect(next.provisioning.b1).toBe(false);
  });

  it("toggleSettings keeps panels mutually exclusive", () => {
    const next = reducer({ ...initialState, computerOpen: true }, { type: "toggleSettings" });
    expect(next.settingsOpen).toBe(true);
    expect(next.computerOpen).toBe(false);
  });
});

describe("wipe resets volatile state", () => {
  it("clears bots, selection, streams, screens, and errors", () => {
    const next = reducer(
      {
        ...initialState,
        bots: [bot({ id: "b1" })],
        selectedId: "b1",
        streaming: { t1: "x" },
        screens: { b1: { png: "p", mime: "image/png" } },
        botErrors: { b1: "boom" },
        error: "e",
        mascotMotion: { botId: "b1", kind: "alert", nonce: 1 },
      },
      { type: "wipe" },
    );
    expect(next.bots).toEqual([]);
    expect(next.selectedId).toBe("");
    expect(next.streaming).toEqual({});
    expect(next.screens).toEqual({});
    expect(next.botErrors).toEqual({});
    expect(next.error).toBeNull();
    expect(next.mascotMotion).toBeNull();
  });
});
