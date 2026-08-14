export type ProactiveReason =
  | "todo-updated"
  | "task-queued"
  | "task-completed"
  | "routine-fired"
  | "agent-message"
  | "user-task";

export type ProactiveBot = {
  name?: string;
  title?: string;
  kind?: "bot" | "group";
  hidden?: boolean;
  busy?: boolean;
  proactiveEnabled?: boolean;
};

export function shouldTriggerProactive(bot: ProactiveBot): boolean {
  return bot.kind !== "group" && !bot.hidden && bot.proactiveEnabled !== false;
}

export function isMeaningfulUpdate(text: string | undefined): boolean {
  const normalized = (text ?? "").trim();
  return Boolean(normalized) && !/^NO_UPDATE[.!]?$/i.test(normalized);
}

export function proactivePrompt(reason: ProactiveReason, context = ""): string {
  return [
    `[Task-triggered check: ${reason}]`,
    "Act on the task event now. Review your active work, durable todos, and teammate status.",
    "Take a useful action when you have a concrete next step, result, blocker, decision, or delegation.",
    "If there is nothing useful to report, reply exactly NO_UPDATE.",
    context.trim(),
  ].join("\n\n");
}
