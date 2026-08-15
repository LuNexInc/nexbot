// Server-backed store. The React app holds no transports of its own:
// it dispatches typed commands over HTTP and folds the one SSE event
// stream from the harness server into local state. The reducer stays
// pure; everything async lives in the wrapped dispatch + SSE fold.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { api } from "./api";
import { initialState, reducer } from "./reducer";
import type { Action, AppState, Bot, OptionCardData } from "./types";

export { api } from "./api";
export type {
  Bot,
  ConfigStatus,
  InstanceInfo,
  Message,
  TurnEffort,
  ModelSelection,
  ReasoningEffort,
  Theme,
  NexColor,
  OptionCardData,
  Routine,
  TodoItem,
} from "./types";

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

const EXPERT_MODE_STORAGE_KEY = "nexbot.expert-mode";
const THEME_STORAGE_KEY = "nexbot.theme";

function initialClientState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const stored = window.localStorage.getItem(EXPERT_MODE_STORAGE_KEY);
    const theme = window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
    return { ...initialState, expertMode: stored !== "false", theme };
  } catch {
    return initialState;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, initialClientState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", state.theme === "dark");
    root.style.colorScheme = state.theme;
  }, [state.theme]);

  // debounced PATCH per bot for text-field edits (name/title/description)
  const patchTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> }>());
  const streamBuffers = useRef(new Map<string, { answer: string; reasoning: string }>());
  const streamTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const botErrorTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flushStream = (threadId: string) => {
    const pending = streamBuffers.current.get(threadId);
    if (!pending) return;
    streamBuffers.current.delete(threadId);
    const timer = streamTimers.current.get(threadId);
    if (timer) clearTimeout(timer);
    streamTimers.current.delete(threadId);
    if (pending.answer) rawDispatch({ type: "streamDelta", threadId, delta: pending.answer });
    if (pending.reasoning) rawDispatch({ type: "reasoningDelta", threadId, delta: pending.reasoning });
  };

  const queueStreamDelta = (threadId: string, delta: string, reasoning = false) => {
    const pending = streamBuffers.current.get(threadId) ?? { answer: "", reasoning: "" };
    if (reasoning) pending.reasoning += delta;
    else pending.answer += delta;
    streamBuffers.current.set(threadId, pending);
    if (!streamTimers.current.has(threadId)) {
      streamTimers.current.set(threadId, setTimeout(() => flushStream(threadId), 40));
    }
  };

  const dispatch = useMemo(() => {
    const showError = (e: unknown) => {
      rawDispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
      setTimeout(() => rawDispatch({ type: "error", message: null }), 6000);
    };
    // fire-and-forget card persistence; the route is optional server-side
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    const wrapped: React.Dispatch<Action> = (action) => {
      if (action.type === "send") {
        const nonce = action.clientNonce ?? `cn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const sendAct = { ...action, clientNonce: nonce };
        rawDispatch(sendAct);
        const bot = stateRef.current.bots.find((b) => b.id === sendAct.botId);
        api(`/api/bots/${sendAct.botId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text: sendAct.text, files: sendAct.files, clientNonce: nonce }),
        }).catch((e) => {
          if (bot) {
            rawDispatch({ type: "messageFailed", threadId: bot.threadId, clientNonce: nonce });
          }
          showError(e);
        });
        return;
      }
      rawDispatch(action);
      switch (action.type) {
        case "setExpertMode":
          try {
            window.localStorage.setItem(EXPERT_MODE_STORAGE_KEY, String(action.enabled));
          } catch {
            // Private browsing or a locked-down webview can reject storage.
          }
          break;
        case "setTheme":
          try {
            window.localStorage.setItem(THEME_STORAGE_KEY, action.theme);
          } catch {
            // Private browsing or a locked-down webview can reject storage.
          }
          break;
        case "retryMessage": {
          const bot = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!bot) break;
          const msg = bot.messages.find(
            (m) =>
              m.clientNonce === action.clientNonce ||
              m.id === `optimistic:${action.clientNonce}`,
          );
          if (!msg) break;
          rawDispatch({
            type: "messagePatched",
            threadId: bot.threadId,
            message: { ...msg, status: "pending" },
          });
          api(`/api/bots/${action.botId}/messages`, {
            method: "POST",
            body: JSON.stringify({
              text: msg.text,
              files: msg.files,
              clientNonce: action.clientNonce,
            }),
          }).catch((e) => {
            rawDispatch({
              type: "messageFailed",
              threadId: bot.threadId,
              clientNonce: action.clientNonce,
            });
            showError(e);
          });
          break;
        }
        case "answerCard": {
          const bot = stateRef.current.bots.find((b) => b.id === action.botId);
          const card = bot?.messages.find((m) => m.id === action.messageId)?.card;
          if (card?.requestId?.startsWith("nexbot-job:")) {
            const jobId = card.requestId.slice("nexbot-job:".length);
            const actionName = action.answer.toLowerCase() === "resume" ? "resume" : "retry";
            persistCard(action.botId, action.messageId, { answered: action.answer });
            api(`/api/jobs/${jobId}/${actionName}`, { method: "POST" }).catch(showError);
          } else if (card?.requestId) {
            const behavior =
              action.answer === "Allow" ? "allow" : action.answer === "Deny" ? "deny" : "answer";
            api(`/api/bots/${action.botId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: card.requestId,
                behavior,
                message: behavior === "answer" ? action.answer : undefined,
              }),
            }).catch(showError);
          } else {
            persistCard(action.botId, action.messageId, { answered: action.answer });
            api(`/api/bots/${action.botId}/messages`, {
              method: "POST",
              body: JSON.stringify({ text: action.answer }),
            }).catch(showError);
          }
          break;
        }
        case "dismissCard": {
          const bot = stateRef.current.bots.find((b) => b.id === action.botId);
          const card = bot?.messages.find((m) => m.id === action.messageId)?.card;
          if (card?.requestId) {
            api(`/api/bots/${action.botId}/respond`, {
              method: "POST",
              body: JSON.stringify({ requestId: card.requestId, behavior: "deny", message: "Dismissed by user." }),
            }).catch(() => {});
          } else {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
        case "newBot":
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify({
              name: action.name,
              title: action.title,
              description: action.description,
              personality: action.personality,
              color: action.color,
              kind: action.kind,
              memberIds: action.memberIds,
              modelSelection: action.modelSelection,
            }),
          })
            .then(({ bot }) => rawDispatch({ type: "botAdded", bot }))
            .catch(showError);
          break;
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          api("/api/bots", { method: "POST" })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: `${source.name} copy`,
                  title: source.title,
                  description: source.description,
                  personality: source.personality,
                  notifications: source.notifications,
                  modelSelection: source.modelSelection,
                  ...(source.computer ? { computer: source.computer } : {}),
                }),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          api(`/api/bots/${action.botId}`, { method: "DELETE" }).catch(showError);
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const bot = stateRef.current.bots.find((b) => b.id === action.id);
          if (bot?.unread) {
            api(`/api/bots/${action.id}`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});
          }
          break;
        }
        case "setModel":
          api(`/api/bots/${action.botId}`, {
            method: "PATCH",
            body: JSON.stringify({ modelSelection: action.selection }),
          }).catch(showError);
          break;
        case "interrupt":
          api(`/api/bots/${action.botId}/interrupt`, { method: "POST" }).catch(showError);
          break;
        case "updateBot": {
          const timers = patchTimers.current;
          const pending = timers.get(action.botId);
          const patch = { ...pending?.patch, ...action.patch };
          if (pending) clearTimeout(pending.timer);
          timers.set(action.botId, {
            patch,
            timer: setTimeout(() => {
              timers.delete(action.botId);
              api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(showError);
            }, 400),
          });
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, []);

  // ── initial load + SSE fold ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const loadAll = () => {
      // hydrate restores unread as persisted. Do not PATCH unread:false for
      // the auto-selected first bot — that would wipe the New chip across restart.
      api("/api/bots")
        .then(({ bots }) => alive && rawDispatch({ type: "hydrate", bots }))
        .catch(() => {});
      api("/api/instances")
        .then(({ instances }) => alive && rawDispatch({ type: "instances", instances }))
        .catch(() => {});
      api("/api/config")
        .then((config) => alive && rawDispatch({ type: "configStatus", config }))
        .catch(() => {});
    };
    loadAll();

    const es = new EventSource("/api/events");
    es.onopen = () => {
      rawDispatch({ type: "connected", value: true });
      loadAll(); // resync anything missed while disconnected
    };
    es.onerror = () => rawDispatch({ type: "connected", value: false });
    es.onmessage = (raw) => {
      let frame: any;
      try {
        frame = JSON.parse(raw.data);
      } catch {
        return;
      }
      switch (frame.kind) {
        case "message":
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message });
          break;
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message });
          break;
        case "bot": {
          const bot = frame.bot as Partial<Bot> & { id: string };
          // reading the selected chat clears its badge immediately
          if (bot.unread && bot.id === stateRef.current.selectedId) {
            bot.unread = false;
            fetch(`/api/bots/${bot.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ unread: false }),
            }).catch(() => {});
          }
          rawDispatch({ type: "botPatched", bot });
          break;
        }
        case "runtime": {
          const event = frame.event;
          if (event.type === "content.delta" && event.streamKind === "assistant_text") {
            queueStreamDelta(event.threadId, event.delta);
          } else if (event.type === "content.delta" && event.streamKind === "reasoning_text") {
            queueStreamDelta(event.threadId, event.delta, true);
          } else if (event.type === "turn.completed") {
            flushStream(event.threadId);
            rawDispatch({ type: "streamClear", threadId: event.threadId });
          }
          break;
        }
        case "screen":
          rawDispatch({ type: "screenFrame", botId: frame.botId, png: frame.png, mime: frame.mime ?? "image/png" });
          break;
        case "computer":
          rawDispatch({ type: "provisioning", botId: frame.botId, on: frame.state === "provisioning" });
          break;
        case "bot.deleted":
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        case "wipe":
          rawDispatch({ type: "wipe" });
          break;
        case "notify":
          if (window.nexbot?.notify) void window.nexbot.notify(frame.title ?? "NexBot", frame.body ?? "");
          break;
        case "stuck":
          if (frame.botId) {
            rawDispatch({ type: "botError", botId: frame.botId, message: frame.body ?? "A bot is stuck — no progress." });
            const previous = botErrorTimers.current.get(frame.botId);
            if (previous) clearTimeout(previous);
            botErrorTimers.current.set(frame.botId, setTimeout(() => {
              botErrorTimers.current.delete(frame.botId);
              rawDispatch({ type: "clearBotError", botId: frame.botId });
            }, 6000));
          } else {
            rawDispatch({ type: "error", message: frame.body ?? "A bot is stuck — no progress." });
          }
          if (window.nexbot?.notify) void window.nexbot.notify(frame.name ?? "NexBot", frame.body ?? "");
          break;
        case "warning":
          if (frame.botId) {
            rawDispatch({ type: "botError", botId: frame.botId, message: frame.body ?? "Stream stalled — no token yet." });
            const previous = botErrorTimers.current.get(frame.botId);
            if (previous) clearTimeout(previous);
            botErrorTimers.current.set(frame.botId, setTimeout(() => {
              botErrorTimers.current.delete(frame.botId);
              rawDispatch({ type: "clearBotError", botId: frame.botId });
            }, 6000));
          } else {
            rawDispatch({ type: "error", message: frame.body ?? "Stream stalled — no token yet." });
          }
          break;
        case "usage":
          if (frame.botId && frame.usage) {
            rawDispatch({ type: "botPatched", bot: { id: frame.botId, usage: frame.usage } });
          }
          break;
        case "todos":
          if (frame.botId && Array.isArray(frame.items)) {
            rawDispatch({ type: "todosUpdated", botId: frame.botId, items: frame.items });
          }
          break;
        // a key changed and the fleet hot-reloaded — refresh the picker so
        // newly available providers un-dim immediately
        case "config":
          rawDispatch({
            type: "configStatus",
            config: { xai: frame.xai, composio: frame.composio, box: frame.box, profile: frame.profile },
          });
          api("/api/instances")
            .then(({ instances }) => rawDispatch({ type: "instances", instances }))
            .catch(() => {});
          break;
      }
    };
    return () => {
      alive = false;
      es.close();
      for (const timer of streamTimers.current.values()) clearTimeout(timer);
      streamTimers.current.clear();
      streamBuffers.current.clear();
      for (const timer of botErrorTimers.current.values()) clearTimeout(timer);
      botErrorTimers.current.clear();
    };
  }, []);

  // Push this-PC frames to the harness so /watch.html and other windows can fold them.
  useEffect(() => {
    if (!window.nexbot?.screenFrame) return;
    const timer = setInterval(() => {
      const busy = stateRef.current.bots.find((b) => b.busy && b.computer !== "off");
      if (!busy) return;
      void window.nexbot!.screenFrame().then((url) => {
        if (!url) return;
        const comma = url.indexOf(",");
        const header = comma >= 0 ? url.slice(0, comma) : "";
        const png = comma >= 0 ? url.slice(comma + 1) : url;
        const mime = header.match(/data:([^;]+)/)?.[1] ?? "image/png";
        fetch(`/api/bots/${busy.id}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ png, mime }),
        }).catch(() => {});
      });
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
