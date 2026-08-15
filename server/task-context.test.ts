import { describe, expect, it } from "vitest";

import { createTaskContext, delegateTask, DEFAULT_TASK_MAX_HOPS, DEFAULT_TASK_MAX_MESSAGES, isTaskDelegation, parseTaskContext } from "./task-context.ts";

describe("task-scoped agent coordination", () => {
  it("gives every root task the same bounded coordination scope", () => {
    const task = createTaskContext("forge");
    expect(task.rootBotId).toBe("forge");
    expect(task.path).toEqual(["forge"]);
    expect(task.maxHops).toBe(DEFAULT_TASK_MAX_HOPS);
    expect(task.maxMessages).toBe(DEFAULT_TASK_MAX_MESSAGES);
  });

  it("lets a child bot delegate while preserving the task budget", () => {
    const root = createTaskContext("forge");
    const first = delegateTask(root, "forge", "research");
    expect(isTaskDelegation(first)).toBe(true);
    if (!isTaskDelegation(first)) return;
    const second = delegateTask(first.child, "research", "desk");
    expect(isTaskDelegation(second)).toBe(true);
    if (!isTaskDelegation(second)) return;
    expect(second.child.path).toEqual(["forge", "research", "desk"]);
    expect(second.child.hops).toBe(2);
    expect(second.child.messages).toBe(2);
    expect(second.parent.path).toEqual(["forge", "research"]);
  });

  it("rejects cycles and a sender outside the active task path", () => {
    const root = createTaskContext("forge");
    const child = delegateTask(root, "forge", "research");
    expect(isTaskDelegation(child)).toBe(true);
    if (!isTaskDelegation(child)) return;
    expect(delegateTask(child.child, "research", "forge")).toEqual({ error: "task delegation would create a cycle" });
    expect(delegateTask(child.child, "desk", "index")).toEqual({ error: "bot is not the active owner of this task" });
  });

  it("rejects a task after the hop or message budget is exhausted", () => {
    const root = { ...createTaskContext("forge"), maxHops: 1 };
    const child = delegateTask(root, "forge", "research");
    expect(isTaskDelegation(child)).toBe(true);
    if (!isTaskDelegation(child)) return;
    expect(delegateTask(child.child, "research", "desk")).toEqual({ error: "task delegation limit reached (1 hops)" });

    const budget = { ...createTaskContext("forge"), messages: DEFAULT_TASK_MAX_MESSAGES };
    expect(delegateTask(budget, "forge", "research")).toEqual({ error: `task message budget reached (${DEFAULT_TASK_MAX_MESSAGES} messages)` });
  });

  it("rejects malformed or expanded contexts from child processes", () => {
    const task = createTaskContext("forge");
    expect(parseTaskContext(JSON.stringify(task))).toEqual(task);
    expect(parseTaskContext({ ...task, maxHops: DEFAULT_TASK_MAX_HOPS + 1 })).toBeNull();
    expect(parseTaskContext({ ...task, path: ["forge", "research"], hops: 0 })).toBeNull();
  });
});
