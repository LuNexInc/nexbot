// Pre/post/on_error hooks for tool calls. Deny-list is environ-guard;
// telemetry is counters only (no secret values).
import { isForbiddenSecretAccess, isPromptInjection } from "./environ-guard.ts";

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

function hasPromptInjection(input: ToolHookInput): boolean {
  const chunks: unknown[] = [input.command, input.path, input.title];
  if (input.raw && typeof input.raw === "object") {
    chunks.push(...Object.values(input.raw as Record<string, unknown>));
  } else if (typeof input.raw === "string") {
    chunks.push(input.raw);
  }
  for (const c of chunks) {
    if (typeof c === "string" && isPromptInjection(c)) return true;
  }
  return false;
}

/** Pre-hook: deny environ / harness-secret harvest and prompt injection payloads. */
export function preToolHook(input: ToolHookInput): ToolHookResult {
  telemetry.calls += 1;
  if (isForbiddenSecretAccess(input)) {
    telemetry.denied += 1;
    telemetry.lastDenied = denyName(input);
    return { allow: false, reason: "blocked a request to read process environment secrets" };
  }
  if (hasPromptInjection(input)) {
    telemetry.denied += 1;
    telemetry.lastDenied = denyName(input);
    return { allow: false, reason: "blocked a potential prompt injection payload" };
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
  if (isForbiddenSecretAccess(input) || hasPromptInjection(input)) {
    telemetry.denied += 1;
    telemetry.lastDenied = denyName(input);
  }
}

export const TOOL_HOOKS = { pre: preToolHook, post: postToolHook, on_error: onToolError } as const;
