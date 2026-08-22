// Antigravity (agy) print-mode driver.
//
// Antigravity is not the Gemini CLI. It uses a newline-delimited stream-json
// protocol from `agy -p`, so it cannot use the ACP Gemini driver. This driver
// keeps the CLI-specific argv and event normalization in one place.
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { augmentedPath } from "../env-path.ts";
import { execFileCli, spawnCli, stopChild } from "../cli-spawn.ts";
import { appendNative } from "./native.ts";
import { scrubAgentChildEnv } from "../environ-guard.ts";
import { discoverCliModels } from "../model-catalog.ts";

const DRIVER_KIND = "antigravity";
const WINDOWS_AGY = join(homedir(), "AppData", "Local", "agy", "bin", "agy.exe");
const DEFAULT_CLI = process.platform === "win32" && existsSync(WINDOWS_AGY) ? WINDOWS_AGY : "agy";

export interface AntigravityConfig {
  cli: string;
  /** Print mode has no interactive permission channel. Keep headless runs safe. */
  fullAuto: boolean;
}

export const ANTIGRAVITY_MODELS = {
  default: "gemini-3.7-flash-medium",
  options: [
    { id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" },
    { id: "gemini-3.7-flash-medium", label: "Gemini 3.7 Flash (Medium)" },
    { id: "gemini-3.7-flash-low", label: "Gemini 3.7 Flash (Low)" },
    { id: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" },
    { id: "gemini-3.6-flash-medium", label: "Gemini 3.6 Flash (Medium)" },
    { id: "gemini-3.6-flash-low", label: "Gemini 3.6 Flash (Low)" },
    { id: "gemini-3.5-flash-high", label: "Gemini 3.5 Flash (High)" },
    { id: "gemini-3.5-flash-medium", label: "Gemini 3.5 Flash (Medium)" },
    { id: "gemini-3.5-flash-low", label: "Gemini 3.5 Flash (Low)" },
    { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
    { id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6" },
    { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
  ],
};

function decodeConfig(raw: unknown): AntigravityConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    cli: typeof o.cli === "string" ? o.cli : DEFAULT_CLI,
    fullAuto: o.fullAuto === false ? false : true,
  };
}

function textFromResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const response = (result as Record<string, unknown>).response;
  return typeof response === "string" ? response : "";
}

/** Build agy's print-mode argv without involving a shell or ACP handshake. */
export function buildAntigravityArgs(turn: SendTurnInput, fullAuto: boolean): string[] {
  const prompt = turn.system ? `${turn.system}\n\n${turn.text}` : turn.text;
  const args = ["-p", prompt, "--output-format", "stream-json"];
  let model = turn.model;
  if (model) {
    if (model.endsWith("-max")) model = model.replace(/-max$/, "-high");
    args.push("--model", model);
  }
  if (turn.reasoningEffort && turn.reasoningEffort !== "auto") {
    args.push("--effort", turn.reasoningEffort === "max" ? "high" : turn.reasoningEffort);
  }
  if (typeof turn.resumeCursor === "string") args.push("--conversation", turn.resumeCursor);
  if (fullAuto) args.push("--dangerously-skip-permissions");
  return args;
}

export const AntigravityDriver: ProviderDriver<AntigravityConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Antigravity", supportsMultipleInstances: true },
  models: ANTIGRAVITY_MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<AntigravityConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const listeners = new Set<RuntimeEventListener>();
    const envForCli = (): Record<string, string | undefined> => ({
      ...process.env,
      ...input.environment,
      PATH: augmentedPath(),
      NPM_CONFIG_LOGLEVEL: "error",
    });
    const models = await discoverCliModels(config.cli, ["models"], envForCli(), ANTIGRAVITY_MODELS);
    const active = new Map<string, {
      stop: () => Promise<void>;
      turnId: string;
      forceSettle: (ok: boolean, stopReason: string | null) => void;
    }>();

    const emit = (event: RuntimeEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const sendTurn = async (turn: SendTurnInput) => {
      if (active.has(turn.threadId)) throw new Error("a turn is already running on this thread");
      const turnId = newId();
      const resumeCursor = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
      const args = buildAntigravityArgs(turn, config.fullAuto);
      const prompt = args[1];

      const env: Record<string, string | undefined> = {
        ...process.env,
        ...input.environment,
        PATH: augmentedPath(),
        NPM_CONFIG_LOGLEVEL: "error",
      };
      scrubAgentChildEnv(env);
      const child = spawnCli(config.cli, args, {
        cwd: turn.cwd ?? homedir(),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      const state = { settled: false, sessionId: resumeCursor, text: "" };
      const itemIds = new Map<number, string>();
      let lastUsageKey = "";
      const settle = (ok: boolean, stopReason: string | null) => {
        if (state.settled) return;
        state.settled = true;
        active.delete(turn.threadId);
        if (state.text.trim()) {
          emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: state.text });
        }
        emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok, stopReason, cost: null });
      };

      const emitUsage = (usage: unknown) => {
        if (!usage || typeof usage !== "object") return;
        const u = usage as Record<string, unknown>;
        const inputTokens = Number(u.input_tokens ?? 0) + Number(u.cache_read_tokens ?? 0);
        const outputTokens = Number(u.output_tokens ?? 0);
        const thinkingTokens = Number(u.thinking_tokens ?? 0);
        const usageKey = `${inputTokens}:${outputTokens}:${thinkingTokens}`;
        if (usageKey === lastUsageKey) return;
        lastUsageKey = usageKey;
        if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) && (inputTokens || outputTokens)) {
          emit({
            ...base(turn.threadId, turnId),
            type: "thread.token-usage.updated",
            input: inputTokens,
            output: outputTokens,
          });
        }
        if (Number.isFinite(thinkingTokens) && thinkingTokens > 0) {
          emit({ ...base(turn.threadId, turnId), type: "item.updated", itemType: "reasoning", tokens: thinkingTokens });
        }
      };

      const handleLine = (line: string) => {
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        appendNative(turn.threadId, { dir: "in", source: "antigravity.stream-json", msg: message });
        const eventName = message?.event;
        if (eventName === "init") {
          state.sessionId = typeof message.conversation_id === "string" ? message.conversation_id : state.sessionId;
          const model = typeof message.init?.model === "string" ? message.init.model : turn.model ?? models.default;
          emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: state.sessionId, model });
          return;
        }
        if (eventName === "step_update") {
          const update = message.step_update ?? {};
          const stepIndex = Number(update.step_index);
          const itemId = itemIds.get(stepIndex) ?? `${state.sessionId ?? turnId}:step-${Number.isFinite(stepIndex) ? stepIndex : itemIds.size}`;
          if (Number.isFinite(stepIndex)) itemIds.set(stepIndex, itemId);
          if (update.state === "ACTIVE" && update.step_type === "tool") {
            const info = update.tool_info ?? {};
            const title = String(update.tool_name ?? info.name ?? "tool");
            emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId, title: title.slice(0, 80) });
          }
          if (update.state === "DONE" && update.step_type === "tool") {
            const failed = Boolean(update.error || update.tool_info?.error);
            emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", itemId, ok: !failed });
          }
          if (update.step_type === "agent_response" && typeof update.text_delta === "string" && update.text_delta) {
            state.text += update.text_delta;
            emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: update.text_delta });
          }
          emitUsage(update.usage);
          return;
        }
        if (eventName === "result") {
          const result = message.result ?? {};
          if (!state.text) {
            const response = textFromResult(result);
            if (response) {
              state.text = response;
              emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: response });
            }
          }
          emitUsage(result.usage);
          const status = String(result.status ?? "").toUpperCase();
          settle(status === "SUCCESS", status === "SUCCESS" ? null : String(result.error ?? result.status ?? "failed"));
        }
      };

      let buffer = "";
      child.stdout!.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim()) handleLine(line);
        }
      });
      let stderr = "";
      child.stderr!.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });
      child.on("error", (error) => {
        emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: `spawn failed: ${error.message}` });
        settle(false, "spawn_error");
      });
      child.on("close", (code) => {
        if (!state.settled) {
          emit({
            ...base(turn.threadId, turnId),
            type: "runtime.error",
            message: `agy exited ${code} before result${stderr ? `: ${stderr.trim().slice(-300)}` : ""}`,
          });
          settle(false, "exit_before_result");
        }
      });

      const stop = () => stopChild(child);
      active.set(turn.threadId, { stop, turnId, forceSettle: settle });
      emit({ ...base(turn.threadId, turnId), type: "turn.started" });
      // Print mode takes the prompt as the -p value. It does not use the
      // Gemini ACP stdin handshake, so close stdin immediately.
      child.stdin!.end();
      appendNative(turn.threadId, { dir: "out", source: "antigravity.stream-json", msg: { prompt, args: args.filter((arg) => arg !== prompt) } });
      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      const version = await new Promise<string | null>((resolve) => {
        execFileCli(config.cli, ["--version"], { timeout: 8000, env: { ...process.env, PATH: augmentedPath() } }, (error, stdout) =>
          resolve(error ? null : stdout.trim()),
        );
      });
      return version ? { state: "available", version } : { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      models,
      snapshot,
      adapter: {
        provider: DRIVER_KIND,
        // agy print mode does not expose the MCP injection flags used by the
        // other NexBot drivers, so the harness will not advertise peer tools.
        capabilities: { sessionModelSwitch: "unsupported" },
        sendTurn,
        interruptTurn: async (threadId) => {
          const entry = active.get(threadId);
          if (!entry) return;
          await entry.stop();
          if (active.get(threadId) === entry) entry.forceSettle(false, "interrupted");
        },
        respondToRequest: async () => {
          throw new Error("Antigravity print mode has no interactive request channel");
        },
        hasSession: (threadId) => active.has(threadId),
        stopAll: async () => {
          for (const [threadId, entry] of [...active.entries()]) {
            await entry.stop();
            if (active.get(threadId) === entry) entry.forceSettle(false, "stopped");
          }
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      generateText: (prompt: string) =>
        new Promise((resolve, reject) => {
          const args = ["-p", prompt, "--output-format", "text", "--model", models.default];
          if (config.fullAuto) args.push("--dangerously-skip-permissions");
          execFileCli(config.cli, args, { timeout: 60_000, env: { ...process.env, PATH: augmentedPath() } }, (error, stdout) =>
            error ? reject(error) : resolve(stdout.trim()),
          );
        }),
      dispose: async () => {
        for (const [threadId, entry] of [...active.entries()]) {
          await entry.stop();
          if (active.get(threadId) === entry) entry.forceSettle(false, "stopped");
        }
        listeners.clear();
      },
    };
  },
};
