// Grok driver — xAI chat-completions API with SSE streaming. Unlike the
// CLI drivers this one is transcript-replay: the server hands it the
// folded thread history each turn (SendTurnInput.transcript) and it emits
// true token-level content.delta events. Also supplies the instance's
// generateText (bot titles, thread names) — the text-generation slot.
import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  ReasoningEffort,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { appendNative } from "./native.ts";
import { applyTodoTool, TODO_OPENAI_TOOL } from "../todo.ts";
import {
  mergeConsecutiveAssistant,
  preserveReasoningOnAssistant,
  reasoningContentFromDelta,
  type HermesMessage,
} from "./hermes.ts";

const DRIVER_KIND = "grok";
const DEFAULT_URL = "https://api.x.ai/v1";

const MODELS = {
  default: "grok-4",
  options: [
    { id: "grok-4", label: "Grok 4" },
    { id: "grok-4-fast", label: "Grok 4 Fast" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
  ],
};

// xAI's reasoning control is a two-step budget. Keep the shared picker useful
// across providers by mapping the middle/deepest choices to the high budget.
function grokReasoningEffort(value: ReasoningEffort | undefined): "low" | "high" | undefined {
  if (!value || value === "auto") return undefined;
  return value === "low" ? "low" : "high";
}

export interface GrokConfig {
  url: string;
  /** resolved at create-time from instance environment / app config */
  apiKeyEnv: string;
}

function decodeConfig(raw: unknown): GrokConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    url: typeof o.url === "string" ? o.url : DEFAULT_URL,
    apiKeyEnv: typeof o.apiKeyEnv === "string" ? o.apiKeyEnv : "XAI_API_KEY",
  };
}

export const GrokDriver: ProviderDriver<GrokConfig> = {
  driverKind: DRIVER_KIND,
  // "(API)" distinguishes this key-billed driver from grokAgent, the CLI one
  metadata: { displayName: "Grok (API)", supportsMultipleInstances: true },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<GrokConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const apiKey = input.environment[config.apiKeyEnv] ?? process.env[config.apiKeyEnv] ?? "";
    const listeners = new Set<RuntimeEventListener>();
    const active = new Map<string, { abort: AbortController; turnId: string }>();

    const emit = (event: RuntimeEvent) => {
      for (const l of [...listeners]) l(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
    type CompleteResult = {
      text: string;
      reasoning: string;
      usage: { input: number; output: number } | null;
      tool_calls: ToolCall[];
    };

    const complete = async (
      messages: HermesMessage[],
      model: string,
      opts: {
        stream: boolean;
        signal?: AbortSignal;
        tools?: unknown[];
        onDelta?: (d: string) => void;
        onReasoning?: (d: string) => void;
        reasoningEffort?: ReasoningEffort;
      },
    ): Promise<CompleteResult> => {
      const wired = mergeConsecutiveAssistant(messages);
      const res = await fetch(`${config.url}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: wired,
          stream: opts.stream,
          ...(opts.tools?.length ? { tools: opts.tools } : {}),
          ...(grokReasoningEffort(opts.reasoningEffort)
            ? { reasoning_effort: grokReasoningEffort(opts.reasoningEffort) }
            : {}),
        }),
        signal: opts.signal ?? AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`xAI HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
      }
      if (!opts.stream) {
        const json: any = await res.json();
        const msg = json.choices?.[0]?.message ?? {};
        return {
          text: msg.content ?? "",
          reasoning: typeof msg.reasoning_content === "string" ? msg.reasoning_content : "",
          usage: json.usage
            ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
            : null,
          tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
        };
      }
      let text = "";
      let reasoning = "";
      let usage: { input: number; output: number } | null = null;
      const toolAcc = new Map<number, ToolCall>();
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let chunk: any;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta ?? {};
          const piece = delta.content;
          if (piece) {
            text += piece;
            opts.onDelta?.(piece);
          }
          const think = reasoningContentFromDelta(delta);
          if (think) {
            reasoning += think;
            opts.onReasoning?.(think);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === "number" ? tc.index : toolAcc.size;
              const cur = toolAcc.get(idx) ?? {
                id: "",
                type: "function" as const,
                function: { name: "", arguments: "" },
              };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.function.name += tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
              toolAcc.set(idx, cur);
            }
          }
          if (chunk.usage) {
            usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
          }
        }
      }
      return { text, reasoning, usage, tool_calls: [...toolAcc.values()].filter((c) => c.function.name) };
    };

    const sendTurn = async (turn: SendTurnInput) => {
      const { threadId } = turn;
      if (!apiKey) throw new Error(`no xAI key — set ${config.apiKeyEnv} or config.json xai.key`);
      if (active.has(threadId)) throw new Error("a turn is already running on this thread");
      const turnId = newId();
      const abort = new AbortController();
      active.set(threadId, { abort, turnId });

      const messages: HermesMessage[] = mergeConsecutiveAssistant([
        ...(turn.system ? [{ role: "system", content: turn.system }] : []),
        ...(turn.transcript ?? []).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.text,
        })),
        { role: "user", content: turn.text },
      ]);
      appendNative(threadId, { dir: "out", source: "xai.chat.completions", msg: { model: turn.model, messages } });

      emit({ ...base(threadId, turnId), type: "turn.started" });
      emit({ ...base(threadId, turnId), type: "session.started", sessionId: null, model: turn.model ?? MODELS.default });

      (async () => {
        try {
          const tools = turn.botId ? [TODO_OPENAI_TOOL] : [];
          let inTok = 0;
          let outTok = 0;
          let lastText = "";
          for (let round = 0; round < 8; round++) {
            const { text, reasoning, usage, tool_calls } = await complete(messages, turn.model || MODELS.default, {
              stream: true,
              signal: abort.signal,
              tools,
              reasoningEffort: turn.reasoningEffort,
              onDelta: (delta) =>
                emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta }),
              onReasoning: (delta) =>
                emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "reasoning_text", delta }),
            });
            lastText = text;
            if (usage) {
              inTok += usage.input;
              outTok += usage.output;
            }
            if (!tool_calls.length) break;
            const assistant = preserveReasoningOnAssistant(
              {
                role: "assistant",
                content: text || null,
                tool_calls,
                reasoning_content: reasoning || undefined,
              },
              reasoning,
            );
            messages.push(assistant);
            for (const call of tool_calls) {
              const name = call.function.name;
              emit({
                ...base(threadId, turnId),
                type: "item.started",
                itemType: "tool",
                itemId: call.id || name,
                title: name,
              });
              let result = `Unknown tool: ${name}`;
              let ok = false;
              if (name === "todo" && turn.botId) {
                let args: { items?: unknown } = {};
                try {
                  args = JSON.parse(call.function.arguments || "{}");
                } catch {
                  args = {};
                }
                const applied = applyTodoTool(turn.botId, args as { items?: import("../todo.ts").TodoInput[] });
                result = applied.text;
                ok = !applied.isError;
              }
              messages.push({ role: "tool", tool_call_id: call.id, content: result });
              emit({
                ...base(threadId, turnId),
                type: "item.completed",
                itemType: "tool",
                itemId: call.id || name,
                ok,
              });
            }
          }
          appendNative(threadId, { dir: "in", source: "xai.chat.completions", msg: { text: lastText, usage: { input: inTok, output: outTok } } });
          if (lastText.trim()) {
            emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text: lastText });
          }
          if (inTok || outTok) {
            emit({ ...base(threadId, turnId), type: "thread.token-usage.updated", input: inTok, output: outTok });
          }
          active.delete(threadId);
          emit({ ...base(threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
        } catch (e) {
          active.delete(threadId);
          const aborted = (e as Error).name === "AbortError";
          if (!aborted) {
            emit({ ...base(threadId, turnId), type: "runtime.error", message: (e as Error).message });
          }
          emit({
            ...base(threadId, turnId),
            type: "turn.completed",
            ok: false,
            stopReason: aborted ? "interrupted" : "error",
            cost: null,
          });
        }
      })();

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      if (!apiKey) {
        return {
          state: "unavailable",
          reason: `no xAI API key — add {"xai":{"key":"xai-…"}} to ~/.nexbot/config.json or set ${config.apiKeyEnv}`,
        };
      }
      return { state: "available", authenticated: true, version: null };
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      models: MODELS,
      snapshot,
      adapter: {
        provider: DRIVER_KIND,
        capabilities: { sessionModelSwitch: "in-session" },
        sendTurn,
        interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
        respondToRequest: async () => {
          throw new Error("grok driver has no pending asks");
        },
        hasSession: (threadId) => active.has(threadId),
        stopAll: async () => {
          for (const { abort } of active.values()) abort.abort();
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      generateText: async (prompt: string) => {
        const { text } = await complete([{ role: "user", content: prompt }], "grok-3-mini", { stream: false });
        return text;
      },
      dispose: async () => {
        for (const { abort } of active.values()) abort.abort();
        listeners.clear();
      },
    };
  },
};
