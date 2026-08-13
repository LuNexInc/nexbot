// Pre/post/on_error hooks for tool calls. Deny-list is environ-guard;
// telemetry is counters only (no secret values).
import { isForbiddenSecretAccess } from "./environ-guard.ts";

export type ToolHookInput = {
  name?: string;
  path?: unknown;
  command?: unknown;
  title?: unknown;
  raw?: unknown;
  error?: unknown;
  durationMs?: number;
};

export type ToolHookResult = { allow: boolean; reason?: string };

export type ToolHookTelemetry = {
  calls: number;
  denied: number;
  errors: number;
  lastDenied?: string;
};

let telemetry: ToolHookTelemetry = { calls: 0, denied: 0, errors: 0 };

export function resetToolHookTelemetry(): void {
  telemetry = { calls: 0, denied: 0, errors: 0 };
}

export function toolHookTelemetry(): ToolHookTelemetry {
  return { ...telemetry };
}

function denyName(input: ToolHookInput): string {
  const n = input.name ?? input.title ?? input.command ?? input.path;
  return typeof n === "string" && n ? n.slice(0, 80) : "tool";
}

/** Pre-hook: deny environ / harness-secret harvest. */
export function preToolHook(input: ToolHookInput): ToolHookResult {
  telemetry.calls += 1;
  if (isForbiddenSecretAccess(input)) {
    telemetry.denied += 1;
    telemetry.lastDenied = denyName(input);
    return { allow: false, reason: "blocked a request to read process environment secrets" };
  }
  return { allow: true };
}

/** Post-hook: duration telemetry only. */
export function postToolHook(_input: ToolHookInput): void {
  /* counters already incremented in pre */
}

/** Error hook: count failures; re-check deny-list so a thrown path still records. */
export function onToolError(input: ToolHookInput): void {
  telemetry.errors += 1;
  if (isForbiddenSecretAccess(input)) {
    telemetry.denied += 1;
    telemetry.lastDenied = denyName(input);
  }
}

export const TOOL_HOOKS = { pre: preToolHook, post: postToolHook, on_error: onToolError } as const;
