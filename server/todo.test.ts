import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { deskPath } from "./desk.ts";
import {
  applyTodoTool,
  canTransition,
  formatTodoList,
  listTodos,
  replaceTodos,
  resetTodoCache,
  todosPath,
  type TodoStatus,
} from "./todo.ts";

const BOT = "bot-todo-1";

describe("todo state machine", () => {
  const allowed: Array<[TodoStatus, TodoStatus]> = [
    ["pending", "in_progress"],
    ["pending", "completed"],
    ["pending", "cancelled"],
    ["in_progress", "completed"],
    ["in_progress", "cancelled"],
    ["in_progress", "pending"],
    ["completed", "pending"],
    ["cancelled", "pending"],
  ];
  const blocked: Array<[TodoStatus, TodoStatus]> = [["cancelled", "in_progress"], ["cancelled", "completed"]];

  it("allows legal transitions", () => {
    for (const [from, to] of allowed) expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
  });
  it("blocks cancelled from skipping pending", () => {
    for (const [from, to] of blocked) expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
  });
});

describe("todo persist", () => {
  beforeEach(() => {
    resetTodoCache();
    rmSync(join(DATA_DIR, "desk"), { recursive: true, force: true });
  });

  it("starts empty and lists", () => {
    expect(listTodos(BOT)).toEqual([]);
    const listed = applyTodoTool(BOT, {});
    expect(listed.isError).toBeFalsy();
    expect(listed.text).toMatch(/empty/i);
  });

  it("writes ~/.nexbot/desk/<bot-id>/todos.json and reloads after cache drop", () => {
    const items = replaceTodos(BOT, [
      { content: "Find sources", status: "pending" },
      { content: "Write brief", status: "pending" },
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((t) => t.status === "pending")).toBe(true);
    const path = todosPath(BOT);
    expect(path).toBe(join(deskPath(BOT), "todos.json"));
    expect(existsSync(path)).toBe(true);
    const disk = JSON.parse(readFileSync(path, "utf8"));
    expect(disk.items).toHaveLength(2);
    expect(disk.items[0].content).toBe("Find sources");

    resetTodoCache(BOT);
    const reloaded = listTodos(BOT);
    expect(reloaded.map((t) => t.content)).toEqual(["Find sources", "Write brief"]);
    expect(reloaded[0].id).toBe(items[0].id);
  });

  it("moves pending -> in_progress -> completed and persists", () => {
    const [a] = replaceTodos(BOT, [{ content: "Draft", status: "pending" }]);
    const mid = replaceTodos(BOT, [{ id: a.id, content: "Draft", status: "in_progress" }]);
    expect(mid[0].status).toBe("in_progress");
    const done = replaceTodos(BOT, [{ id: a.id, content: "Draft", status: "completed" }]);
    expect(done[0].status).toBe("completed");
    resetTodoCache();
    expect(listTodos(BOT)[0].status).toBe("completed");
  });

  it("cancels a pending item and only reopens to pending", () => {
    const [a] = replaceTodos(BOT, [{ content: "Skip me", status: "pending" }]);
    const cancelled = replaceTodos(BOT, [{ id: a.id, content: "Skip me", status: "cancelled" }]);
    expect(cancelled[0].status).toBe("cancelled");
    expect(() =>
      replaceTodos(BOT, [{ id: a.id, content: "Skip me", status: "in_progress" }]),
    ).toThrow(/cannot move/);
    const reopened = replaceTodos(BOT, [{ id: a.id, content: "Skip me", status: "pending" }]);
    expect(reopened[0].status).toBe("pending");
  });

  it("keeps only one in_progress (last wins, others drop to pending)", () => {
    const created = replaceTodos(BOT, [
      { content: "A", status: "pending" },
      { content: "B", status: "pending" },
    ]);
    const next = replaceTodos(BOT, [
      { id: created[0].id, content: "A", status: "in_progress" },
      { id: created[1].id, content: "B", status: "in_progress" },
    ]);
    const active = next.filter((t) => t.status === "in_progress");
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("B");
    expect(next.find((t) => t.content === "A")?.status).toBe("pending");
  });

  it("applyTodoTool surfaces state-machine errors without clobbering disk", () => {
    const [a] = replaceTodos(BOT, [{ content: "Hold", status: "cancelled" }]);
    const result = applyTodoTool(BOT, { items: [{ id: a.id, content: "Hold", status: "completed" }] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/cannot move/);
    expect(listTodos(BOT)[0].status).toBe("cancelled");
  });

  it("rejects empty content", () => {
    expect(() => replaceTodos(BOT, [{ content: "  ", status: "pending" }])).toThrow(/content/);
  });
});

describe("todo edge cases", () => {
  it("rejects an invalid status on a new item", () => {
    expect(() => replaceTodos(BOT, [{ content: "X", status: "done" }])).toThrow(/invalid status/);
  });

  it("rejects a duplicate id", () => {
    const [a] = replaceTodos(BOT, [{ content: "A", status: "pending" }]);
    expect(() =>
      replaceTodos(BOT, [
        { id: a.id, content: "A", status: "pending" },
        { id: a.id, content: "B", status: "pending" },
      ]),
    ).toThrow(/duplicate todo id/);
  });

  it("formatTodoList marks statuses and reports empty", () => {
    const list = formatTodoList([
      { id: "1", content: "draft", status: "in_progress" },
      { id: "2", content: "run", status: "completed" },
    ]);
    expect(list).toContain("[>] 1 draft");
    expect(list).toContain("[x] 2 run");
    expect(formatTodoList([])).toMatch(/empty/i);
  });

  it("malformed todos.json on disk yields an empty list", () => {
    const p = todosPath(BOT);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "not json");
    resetTodoCache(BOT);
    expect(listTodos(BOT)).toEqual([]);
  });
});
