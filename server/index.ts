// NexBot server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { configStatus } from "./app-meta.ts";
import * as box from "./box.ts";
import * as composio from "./composio.ts";
import { defaultInstanceConfigs, ensureDirs, instanceConfigs, loadConfig, saveConfig, DATA_DIR, EVENTS_DIR, NATIVE_DIR, wipePassword } from "./config.ts";
import type { ModelSelection, ReasoningEffort, RuntimeEvent } from "./contracts.ts";
import { readCuaConnection } from "./cua-connection.ts";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { EventBus } from "./harness/bus.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { appendLog, buildPersona, deskPath, deskPrompt, ensureDesk, ensureMemory, inboxPath, MEMORY_FILE_MAX, memoryDir, memoryPrompt, readLog, readProfile, writeInboxFile, writeLog, writeProfile } from "./desk.ts";
import { json, readBody, serveStatic, portBusyHint } from "./http-util.ts";
import { searchMessages } from "./db.ts";
import { completeReceipt, interruptReceipts, listReceipts, observeFrame, startReceipt, type ExecutionReceipt } from "./execution-evidence.ts";
import { classifyPermission } from "./risk-policy.ts";
import { enqueueTurn, queuedTurns, removeQueuedTurnsForBot, takeNextTurn } from "./turn-queue.ts";
import { listMemoryFacts, memoryFactsPrompt, saveMemoryFact, searchMemoryFacts } from "./memory-facts.ts";
import { createCredential, credentialsForBot, deleteCredential, listCredentials, revealGrantedCredential, setCredentialGrants } from "./credentials.ts";
import { doctorOverall, localDoctorChecks } from "./doctor.ts";
import { forgetTurn, rememberTurn } from "./pending.ts";
import { prepareReflexionPrompt, sessionDeathSettlement } from "./recovery.ts";
import { createJob, getJob, listJobs, updateJob } from "./jobs.ts";
import {
  createRoutine,
  createRoutineFromTurn,
  deleteRoutine,
  deleteRoutinesForBot,
  dueRoutines,
  listRoutines,
  markRan,
  normalizeRoutineKind,
  patchRoutine,
  routineCreateError,
  routineHookPath,
} from "./routines.ts";
import { ASK_BOT_STILL_WORKING, ASK_BOT_WAIT_MS, boundToolOutput } from "./comms-policy.ts";
import { createScreenPoller } from "./screen-poller.ts";
import { detectCapabilities } from "./capabilities.ts";
import { clipForTurn, handoffThreadIds, mentionedBots, Store, type Message, type NexColor, type TurnEffort } from "./store.ts";
import { isChiefOfStaffRole, roleByTitle, SLEEP_WARNING, teammateGreeting, withRolePrompt, isForbiddenFightAsk } from "./roles.ts";
import { applyTodoTool, listTodos, onTodosChange } from "./todo.ts";
import { autoDistillFromTurn, deleteSkill, listSkills, saveSkill, skillFromTurn, skillsPrompt } from "./skills.ts";
import { onToolError, postToolHook, preToolHook } from "./tool-hooks.ts";
import { checkSteerToken, loadSteerToken, rotateSteerToken, tokenFromRequest } from "./steer.ts";
import {
  authorizeHarnessRequest,
  bindIsOffLoopback,
  loadHarnessToken,
  requestIsLoopback,
  rotateHarnessToken,
  tokenFromHarnessRequest,
} from "./harness-auth.ts";
import {
  authenticateRemoteToken,
  consumePairingCode,
  createPairingCode,
  createRemoteDevice,
  pairingCodeUrls,
  pairingMobileUrls,
  pairingUrls,
  remoteAccessEnabled,
  remoteAccessStatus,
  listRemoteDevices,
  revokeRemoteDevice,
  rotateRemoteDevice,
} from "./remote-access.ts";
import { stripWorkingNarration } from "../src/lib/activity.ts";
import { createNonceCache } from "./nonce.ts";
import { createWatchdog, DEFAULT_MAX_TOKENS_PER_TURN, isComputerToolName } from "./watchdog.ts";
import { chooseAntigravityCosSelection, pickDefaultSelection } from "./selection.ts";
import { isMeaningfulUpdate, proactivePrompt, shouldTriggerProactive, type ProactiveReason } from "./proactivity.ts";
import { routingDirective, suggestSpecialistRoutes } from "./routing.ts";
import { semanticRoute, type SemanticRouteDecision } from "./semantic-router.ts";
import { loadAgentInbox, persistAgentInbox, type StoredAgentMessage } from "./agent-inbox.ts";
import { createTaskContext, delegateTask, isTaskDelegation, parseTaskContext, type TaskContext } from "./task-context.ts";
import { wipeLocalData } from "./wipe.ts";
import { renderArtifactsForReply, serveArtifact } from "./artifacts.ts";
import { enqueueConversationArchive, ensureConversationArchive, freshSessionContextPrompt } from "./conversation-context.ts";
import {
  isWireGuardEndpoint,
  isWireGuardPublicKey,
  provisionWireGuardPeer,
  revokeWireGuardPeer,
  setupWireGuard,
  wireGuardStatus,
} from "./wireguard.ts";

const PORT = Number(process.env.NEXBOT_PORT || 8799);
const STATIC_DIR = process.env.NEXBOT_STATIC_DIR || null;
// In development the browser is served by Vite; packaged builds serve the
// UI from this server. Pairing links must point at the UI port in both cases.
const WEB_PORT = STATIC_DIR ? PORT : Number(process.env.NEXBOT_WEB_PORT || 5199);

ensureDirs();
const cfg = loadConfig();
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));

const bus = new EventBus();
bus.attach(registry.instances());

// ── peer-agent comms wiring ────────────────────────────────────────────
// A shared secret guards the localhost-only /api/internal endpoints the
// agents-proxy calls; regenerated each boot (the proxy gets it via env).
const COMMS_TOKEN = randomBytes(24).toString("hex");
// proxy entry: .ts in dev (node type-strips), .js in the packaged dist-server
const agentsProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();
// in the packaged app process.execPath is Electron — run the proxy as node
const AGENTS_NODE_FLAG = { ELECTRON_RUN_AS_NODE: "1" };

function agentsIntegration(botId: string, taskContext: TaskContext) {
  return {
    command: process.execPath,
    args: [agentsProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      NEXBOT_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      NEXBOT_BOT_ID: botId,
      NEXBOT_COMMS_TOKEN: COMMS_TOKEN,
      NEXBOT_TASK_CONTEXT: JSON.stringify(taskContext),
    },
  };
}

const todoProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "todo.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();

function todosIntegration(botId: string) {
  return {
    command: process.execPath,
    args: [todoProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      NEXBOT_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      NEXBOT_BOT_ID: botId,
      NEXBOT_COMMS_TOKEN: COMMS_TOKEN,
    },
  };
}

const credentialProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "credential-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();

function credentialsIntegration(botId: string) {
  const cua = readCuaConnection();
  return {
    command: process.execPath,
    args: [credentialProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      NEXBOT_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      NEXBOT_BOT_ID: botId,
      NEXBOT_COMMS_TOKEN: COMMS_TOKEN,
      ...(cua ? { NEXBOT_CUA_SPEC: JSON.stringify(cua) } : {}),
    },
  };
}

const cuaGateProxyPath = (() => {
  const ts = join(dirname(fileURLToPath(import.meta.url)), "cua-gate-proxy.ts");
  return existsSync(ts) ? ts : ts.replace(/\.ts$/, ".js");
})();

function localComputerIntegration(botId: string, cua: NonNullable<ReturnType<typeof readCuaConnection>>) {
  return {
    command: process.execPath,
    args: [cuaGateProxyPath],
    env: {
      ...AGENTS_NODE_FLAG,
      NEXBOT_HARNESS_URL: `http://127.0.0.1:${PORT}`,
      NEXBOT_BOT_ID: botId,
      NEXBOT_COMMS_TOKEN: COMMS_TOKEN,
      NEXBOT_CUA_SPEC: JSON.stringify(cua),
    },
  };
}

/** Run a turn on `targetBotId` and resolve with its assistant text — the
 * synchronous half of ask_bot. Subscribes to the bus, folds assistant_text
 * for that thread, resolves on turn.completed (or a 4-min ceiling). */
type StartTurnOpts = {
  taskContext?: TaskContext;
  replay?: boolean;
  jobId?: string;
  resume?: boolean;
  groupId?: string;
  fromBot?: { id: string; name: string; color?: string };
  chatText?: string;
  clientNonce?: string;
  source?: "user" | "agent" | "routine" | "proactive" | "completion";
  onComplete?: { targetBotId: string; messageTemplate?: string };
  maxTokens?: number;
  /** Reuse a durable pending message when draining the user turn queue. */
  existingMessageId?: string;
  /** The caller waits for this turn and relays its result, so do not emit a second completion ping. */
  relayResult?: boolean;
};

const nonceCache = createNonceCache(60_000);
// A relay wait owns the user-facing result when the target finishes within
// the wait window. If the wait times out, the target's completion report must
// still reach Chief of Staff after the target eventually finishes.
const relayResolvedThreads = new Set<string>();

function askBotAndWait(
  fromBotId: string,
  targetBotId: string,
  message: string,
  taskContext: TaskContext,
  extra?: Pick<StartTurnOpts, "fromBot" | "chatText">,
): Promise<string> {
  const target = store.bot(targetBotId);
  if (!target) return Promise.resolve("(no such bot)");
  const threadId = target.threadId;
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    // A peer may take longer than the watchdog's no-event threshold. Keep the
    // caller's turn alive while ask_bot waits, without emitting user-visible
    // progress or extending the overall four-minute wait ceiling.
    watchdog.poke(fromBotId, "ask_bot.wait");
    const heartbeat = setInterval(() => watchdog.poke(fromBotId, "ask_bot.wait"), 15_000);
    const finish = (out: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      unsub();
      resolve(out);
    };
    const unsub = bus.subscribe((e: RuntimeEvent) => {
      if (e.threadId !== threadId) return;
      if (e.type === "item.completed" && e.itemType === "assistant_text") {
        text += (text ? "\n" : "") + e.text;
      } else if (e.type === "turn.completed") {
        if (!e.ok) {
          finish(ASK_BOT_STILL_WORKING);
          return;
        }
        relayResolvedThreads.add(threadId);
        finish(boundToolOutput(text) || "(the bot finished without a text reply)");
      }
    });
    // Never relay an unfinished progress stream as the specialist's answer.
    // The target's later completion report remains the source of truth.
    const timer = setTimeout(() => finish(ASK_BOT_STILL_WORKING), ASK_BOT_WAIT_MS);
    startTurn(targetBotId, message, { taskContext, source: "agent", relayResult: true, ...extra }).catch((err) =>
      finish(`(couldn't start that bot: ${err instanceof Error ? err.message : String(err)})`),
    );
  });
}

// default selection: first available authenticated instance. Prefer grok, then
// codex. Never pick Claude unless it is the only available driver (no Claude auth).
async function defaultSelection() {
  return pickDefaultSelection(await registry.describe());
}

const REASONING_EFFORTS = new Set<ReasoningEffort>(["auto", "low", "medium", "high", "max"]);
function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && REASONING_EFFORTS.has(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : undefined;
}

let bootSelection = { instanceId: "grok", model: "grok-4.5" };
const store = new Store(() => bootSelection);
bootSelection = await defaultSelection();
store.seedIfEmpty();
store.ensureTeamSeeds();
sessionDeathSettlement(store);
const watchdog = createWatchdog({ stuckMs: 90_000 });
let steerToken = loadSteerToken();
/** botId → group thread that started this turn (shared transcript). */
const turnGroup = new Map<string, string>();
type TurnKind = "user" | "agent" | "routine" | "proactive" | "completion";
const turnMeta = new Map<string, {
  kind: TurnKind;
  messageStart: number;
  startedAt: number;
  sourceBotId?: string;
  jobId?: string;
  relayResult?: boolean;
  reasoningText?: string;
  reasoningTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}>();
type QueuedAgentMessage = StoredAgentMessage;
const agentInbox = loadAgentInbox();
type CompletionReport = { botId: string; name: string; text: string; at: number };
const completionReports: CompletionReport[] = [];
let cosReportTimer: ReturnType<typeof setTimeout> | undefined;
const proactivePending = new Map<string, Set<ProactiveReason>>();
const taskMessageCounts = new Map<string, number>();

// ── SSE fan-out to clients ─────────────────────────────────────────────
const sseClients = new Set<ServerResponse>();
function broadcast(payload: unknown) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}
onTodosChange((botId, items) => {
  broadcast({ kind: "todos", botId, items });
  triggerProactive(botId, "todo-updated", "The durable todo list changed.");
});

// ── live screen poller ─────────────────────────────────────────────────
const screens = createScreenPoller({
  isConfigured: () => box.boxConfigured(cfg),
  screenshot: (botId) => box.screenshotBox(cfg, botId),
  onFrame: (botId, frame) => broadcast({ kind: "screen", botId, ...frame }),
});

// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map<string, string>(); // itemId -> messageId
const receiptByItem = new Map<string, string>(); // itemId -> receiptId
const receiptMessage = new Map<string, { threadId: string; messageId: string }>();
const askMessageByRequest = new Map<string, string>(); // requestId -> messageId
const turnTools = new Map<string, { names: string[]; okNames: string[] }>();

function patchReceiptMessage(receipt: ExecutionReceipt): void {
  const link = receiptMessage.get(receipt.id);
  if (!link) return;
  const existing = store.messagesFor(link.threadId).find((message) => message.id === link.messageId);
  if (!existing?.tool) return;
  const patched = store.patchMessage(link.threadId, link.messageId, {
    tool: {
      ...existing.tool,
      ok: receipt.status === "running" ? undefined : receipt.status === "succeeded",
      receiptId: receipt.id,
      evidence: receipt.verification,
    },
  });
  if (patched) broadcast({ kind: "message.patch", threadId: link.threadId, message: patched });
}

bus.subscribe((event: RuntimeEvent) => {
  broadcast({ kind: "runtime", event });
  const bot = store.botByThread(event.threadId);
  if (!bot) return;
  const extra: { tokens?: { input: number; output: number }; computerTool?: boolean; isChunk?: boolean } = {};
  if (event.type === "thread.token-usage.updated") {
    extra.tokens = { input: event.input ?? 0, output: event.output ?? 0 };
    store.patchBot(bot.id, { usage: extra.tokens });
    broadcast({ kind: "usage", botId: bot.id, usage: extra.tokens });
    const currentTurn = turnMeta.get(bot.id);
    if (currentTurn) {
      currentTurn.inputTokens = event.input ?? 0;
      currentTurn.outputTokens = event.output ?? 0;
      const currentJob = currentTurn.jobId ? getJob(currentTurn.jobId) : null;
      const ceiling = currentJob?.maxTokens ?? DEFAULT_MAX_TOKENS_PER_TURN;
      if (watchdog.isBudgetExceeded(bot.id, ceiling)) {
        console.warn(`[watchdog] Token budget ceiling exceeded for bot ${bot.name} (${bot.id})`);
      }
    }
  }
  if (event.type === "item.started" && event.itemType === "tool") {
    extra.computerTool = isComputerToolName(event.title);
  }
  if (event.type === "content.delta") extra.isChunk = true;
  const ttfrJustNow = watchdog.poke(bot.id, event.type, extra);
  if (ttfrJustNow !== undefined) {
    store.patchBot(bot.id, { lastTtfrMs: ttfrJustNow });
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
  }

  const pushMessage = (m: Omit<Message, "id" | "at">) => {
    const message = store.appendMessage(event.threadId, m);
    broadcast({ kind: "message", threadId: event.threadId, message });
    return message;
  };

  switch (event.type) {
    case "session.started":
      if (event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
        const turnState = turnMeta.get(bot.id);
        if (turnState?.jobId) {
          updateJob(turnState.jobId, {
            providerInstanceId: event.providerInstanceId,
            resumeCursor: event.sessionId,
          });
        }
      }
      break;
    case "item.completed":
      if (event.itemType === "assistant_text") {
        const text = stripWorkingNarration(event.text);
        const currentTurn = turnMeta.get(bot.id);
        if (text.trim() && !(currentTurn?.kind === "proactive" && !isMeaningfulUpdate(text))) {
          const files = renderArtifactsForReply(bot.id, text);
          pushMessage({
            role: "bot",
            kind: "text",
            text,
            ...(files.length ? { files } : {}),
            source: currentTurn?.kind === "proactive" ? "proactive" : undefined,
          });
          const gid = turnGroup.get(bot.id);
          if (gid) {
            const group = store.bot(gid);
            if (group) {
              const copied = store.appendMessage(group.threadId, {
                role: "bot",
                kind: "text",
                text: `@${bot.name}: ${text}`,
              });
              broadcast({ kind: "message", threadId: group.threadId, message: copied });
            }
          }
        }
      } else if (event.itemType === "tool" && event.itemId) {
        const messageId = toolMessageByItem.get(event.itemId);
        const existingName = store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool";
        if (event.ok === false) onToolError({ name: existingName, title: existingName });
        else postToolHook({ name: existingName, title: existingName });
        const tools = turnTools.get(bot.id);
        if (tools && event.ok !== false) tools.okNames.push(existingName);
        const receiptId = receiptByItem.get(event.itemId);
        const receipt = receiptId ? completeReceipt(receiptId, event.ok !== false) : null;
        if (receipt) patchReceiptMessage(receipt);
        if (messageId) {
          const existingTool = store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool;
          const patched = store.patchMessage(event.threadId, messageId, {
            tool: { ...existingTool, name: existingName, ok: event.ok },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
          toolMessageByItem.delete(event.itemId);
        }
        receiptByItem.delete(event.itemId);
        screens.poke(bot.id);
      }
      break;
    case "item.updated": {
      if (event.itemType === "reasoning" && event.tokens != null) {
        const currentTurn = turnMeta.get(bot.id);
        if (currentTurn) currentTurn.reasoningTokens = Math.max(currentTurn.reasoningTokens ?? 0, event.tokens);
      }
      break;
    }
    case "content.delta": {
      if (event.streamKind === "reasoning_text") {
        const currentTurn = turnMeta.get(bot.id);
        if (currentTurn) {
          const next = `${currentTurn.reasoningText ?? ""}${event.delta}`;
          // Keep the useful summary bounded so a verbose provider cannot make
          // transcript writes or hydration slow over time.
          currentTurn.reasoningText = next.slice(0, 12_000);
        }
      }
      break;
    }
    case "item.started": {
      if (event.itemType === "tool") {
        const name = event.title ?? "tool";
        const hook = preToolHook({ name, title: name });
        const row = turnTools.get(bot.id) ?? { names: [], okNames: [] };
        row.names.push(name);
        turnTools.set(bot.id, row);
        const receipt = startReceipt({
          botId: bot.id,
          threadId: event.threadId,
          jobId: turnMeta.get(bot.id)?.jobId,
          itemId: event.itemId,
          eventId: event.eventId,
          action: name,
          visual: isComputerToolName(name),
        });
        const message = pushMessage({
          role: "bot",
          kind: "activity",
          tool: {
            name: hook.allow ? name : `blocked: ${name}`,
            ok: hook.allow ? undefined : false,
            receiptId: receipt.id,
            evidence: receipt.verification,
          },
        });
        receiptMessage.set(receipt.id, { threadId: event.threadId, messageId: message.id });
        if (event.itemId) {
          toolMessageByItem.set(event.itemId, message.id);
          receiptByItem.set(event.itemId, receipt.id);
        }
      }
      break;
    }
    case "request.opened": {
      if (event.requestType === "permission" && event.requestId) {
        const decision = classifyPermission(event.tool, event.summary);
        if (decision.action === "allow") {
          const instance = registry.get(bot.modelSelection.instanceId);
          void instance?.adapter.respondToRequest(bot.threadId, event.requestId, { behavior: "allow" }).catch(() => {});
          break;
        }
        const message = pushMessage({
          role: "bot",
          kind: "options",
          card: {
            title: "Approve this action?",
            subtitle: event.summary,
            options: ["Allow", "Deny"],
            requestId: event.requestId,
            risk: decision.level,
            riskReason: decision.reason,
          },
        });
        askMessageByRequest.set(event.requestId, message.id);
        break;
      }
      const message = pushMessage({
        role: "bot",
        kind: "options",
        card: {
          title: "Your bot has a question",
          subtitle: event.summary,
          options: event.choices?.length ? event.choices : [],
          requestId: event.requestId,
        },
      });
      if (event.requestId) askMessageByRequest.set(event.requestId, message.id);
      break;
    }
    case "request.resolved": {
      const messageId = event.requestId ? askMessageByRequest.get(event.requestId) : null;
      if (messageId) {
        const existing = store.messagesFor(event.threadId).find((m) => m.id === messageId);
        if (existing?.card && !existing.card.answered) {
          const patched = store.patchMessage(event.threadId, messageId, {
            card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
        }
        if (event.requestId) askMessageByRequest.delete(event.requestId);
      }
      break;
    }
    case "runtime.error":
      onToolError({ name: "runtime.error", title: event.message });
      pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
      break;
    case "turn.completed": {
      const currentTurn = turnMeta.get(bot.id);
      const turnText = currentTurn
        ? store
            .messagesFor(bot.threadId)
            .slice(currentTurn.messageStart)
            .filter((m) => m.role === "bot" && m.kind === "text")
            .map((m) => m.text ?? "")
             .join("\n")
        : "";
      if (currentTurn) {
        const used = turnTools.get(bot.id);
        const effort: TurnEffort = {
          durationMs: Math.max(0, Date.now() - currentTurn.startedAt),
          ...(currentTurn.reasoningTokens ? { reasoningTokens: currentTurn.reasoningTokens } : {}),
          ...(currentTurn.inputTokens ? { inputTokens: currentTurn.inputTokens } : {}),
          ...(currentTurn.outputTokens ? { outputTokens: currentTurn.outputTokens } : {}),
          ...(used?.names.length ? { toolCount: used.names.length } : {}),
          cost: event.cost ?? null,
        };
        const lastAssistant = store
          .messagesFor(bot.threadId)
          .slice(currentTurn.messageStart)
          .reverse()
          .find((m) => m.role === "bot" && m.kind === "text");
        if (lastAssistant) {
          const patch: Partial<Message> = { effort };
          if (currentTurn.reasoningText?.trim()) patch.reasoning = currentTurn.reasoningText.trim();
          const patched = store.patchMessage(bot.threadId, lastAssistant.id, patch);
          if (patched) broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
        }
      }
      // only fold a screen frame when this turn used computer tools
      const meta = watchdog.end(bot.id);
      const frame = screens.stop(bot.id);
      if (frame && meta?.computerTools) {
        pushMessage({ role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
      }
      if (currentTurn?.jobId) {
        const job = getJob(currentTurn.jobId);
        updateJob(currentTurn.jobId, {
          status: event.ok === false ? "failed" : "completed",
          error: event.ok === false ? event.stopReason ?? "provider turn failed" : undefined,
        });
        if (event.ok !== false && job?.onComplete?.targetBotId) {
          const targetBot = store.bot(job.onComplete.targetBotId);
          if (targetBot && !targetBot.busy) {
            const defaultMsg = `Pipeline step completed by ${bot.name}: ${job.text.slice(0, 300)}`;
            const text = job.onComplete.messageTemplate || defaultMsg;
            startTurn(targetBot.id, text, {
              source: "completion",
              fromBot: { id: bot.id, name: bot.name, color: bot.color },
            }).catch((err) => console.error("pipeline handoff error:", err));
          }
        }
      }
      store.patchBot(bot.id, { busy: false, unread: true, ...(meta?.ttfrMs !== undefined ? { lastTtfrMs: meta.ttfrMs } : {}) });
      const used = turnTools.get(bot.id);
      turnTools.delete(bot.id);
      if (used && used.okNames.length >= 2) {
        const msgs = store.messagesFor(bot.threadId);
        const userText = [...msgs].reverse().find((m) => m.role === "user" && m.kind === "text")?.text ?? "";
        const assistantText = [...msgs].reverse().find((m) => m.role === "bot" && m.kind === "text")?.text ?? "";
        autoDistillFromTurn({ userText, assistantText, toolNames: used.okNames });
      }
      turnGroup.delete(bot.id);
      turnMeta.delete(bot.id);
      forgetTurn(bot.id);
      enqueueConversationArchive(bot.id, store.messagesFor(bot.threadId));
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      if (bot.notifications !== false && !(currentTurn?.kind === "proactive" && !isMeaningfulUpdate(turnText))) {
        broadcast({ kind: "notify", botId: bot.id, title: bot.name, body: `${bot.name} finished.` });
      }
      if (currentTurn?.kind !== "proactive" && currentTurn?.kind !== "completion") {
        if (currentTurn?.relayResult) {
          // askBotAndWait runs as a later bus subscriber. Defer this check by
          // one tick so a completed relay can suppress the duplicate report;
          // a timed-out relay leaves the set empty and keeps the report.
          setTimeout(() => {
            if (relayResolvedThreads.delete(bot.threadId)) return;
            enqueueCompletionReport(bot, turnText);
          }, 0);
        } else {
          enqueueCompletionReport(bot, turnText);
        }
      }
      if (completionReports.length > 0) scheduleCompletionReport();

      // Dequeue any group messages that arrived while this bot was busy
      const queued = groupQueuedTurns.get(bot.id);
      const pendingReasons = proactivePending.get(bot.id);
      if (currentTurn?.kind === "proactive") {
        // Todo writes made by a proactive turn are part of that turn. Do not
        // let the write trigger an endless self-wake cycle.
        proactivePending.delete(bot.id);
      } else if (!queued?.length && !agentInbox.get(bot.id)?.length && pendingReasons?.size) {
        const reason = pendingReasons.values().next().value as ProactiveReason;
        proactivePending.delete(bot.id);
        setTimeout(() => triggerProactive(bot.id, reason), 50);
      }
      if (queuedTurns(bot.id).length > 0) {
        setTimeout(() => drainUserQueue(bot.id), 50);
      } else if (queued && queued.length > 0) {
        groupQueuedTurns.delete(bot.id);
        const mergedText = queued.map((q) => q.text).join("\n\n---\n\n");
        const gid = queued[0]?.groupId;
        setTimeout(() => {
          void startTurn(bot.id, mergedText, { taskContext: createTaskContext(bot.id), source: "agent", groupId: gid }).catch(() => {});
        }, 50);
      } else {
        setTimeout(() => drainAgentInbox(bot.id), 50);
      }
      break;
    }
  }
});

function appendHandoff(opts: {
  from?: { id: string; name: string; color?: string } | null;
  to: { id: string; name: string; color?: string };
  text: string;
}) {
  const fromLabel = opts.from?.name ?? "you";
  const text = `Handoff from @${fromLabel} → @${opts.to.name}:\n\n${opts.text}`;
  const payload: Omit<Message, "id" | "at"> = { role: "bot", kind: "text", text, source: "agent" };
  for (const threadId of handoffThreadIds({ from: opts.from, to: opts.to, bots: store.bots })) {
    const message = store.appendMessage(threadId, payload);
    broadcast({ kind: "message", threadId, message });
  }
}

/**
 * Route a Chief of Staff user turn in the harness before a provider call.
 * This keeps orchestration available to print-mode drivers such as agy, which
 * cannot receive NexBot's peer-agent tools through MCP.
 */
async function autoRouteChiefTurn(
  bot: NonNullable<ReturnType<typeof store.bot>>,
  text: string,
  taskContext: TaskContext,
): Promise<SemanticRouteDecision | null> {
  const peers = store.bots.filter((peer) => peer.id !== bot.id && !peer.hidden);
  const decision = await semanticRoute(text, peers);
  if (!decision) return null;
  const target = store.bot(decision.peer.id);
  if (!target || target.hidden || target.id === bot.id) return null;
  const delegation = authorizeTaskDelegation(taskContext, bot.id, target.id);
  if (!isTaskDelegation(delegation)) return null;

  appendHandoff({
    from: { id: bot.id, name: bot.name, color: bot.color },
    to: { id: target.id, name: target.name, color: target.color },
    text,
  });

  const delegatedText = `[Task from Chief of Staff]\n\n${text}`;
  try {
    if (target.busy || target.operatorControl) {
      queueAgentMessage(target.id, {
        fromBotId: bot.id,
        message: text,
        taskContext: delegation.child,
        at: Date.now(),
      });
      drainAgentInbox(target.id);
    } else {
      void (async () => {
        try {
          const result = await askBotAndWait(bot.id, target.id, delegatedText, delegation.child, {
            fromBot: { id: bot.id, name: bot.name, color: bot.color },
            chatText: text,
          });
          if (!result || result === ASK_BOT_STILL_WORKING) return;
          const targetReply = [...store.messagesFor(target.threadId)]
            .reverse()
            .find((message) => message.role === "bot" && message.kind === "text" && message.text?.trim());
          const files = targetReply?.files?.length ? targetReply.files : renderArtifactsForReply(target.id, result);
          const reply = store.appendMessage(bot.threadId, {
            role: "bot",
            kind: "text",
            text: result,
            source: "agent",
            fromBot: { id: target.id, name: target.name, color: target.color },
            ...(files?.length ? { files } : {}),
          });
          broadcast({ kind: "message", threadId: bot.threadId, message: reply });
        } catch (error) {
          const failure = store.appendMessage(bot.threadId, {
            role: "bot",
            kind: "text",
            source: "agent",
            text: `I could not bring back ${target.name}'s result. ${error instanceof Error ? error.message : String(error)}`,
          });
          broadcast({ kind: "message", threadId: bot.threadId, message: failure });
        }
      })();
    }
  } catch (error) {
    const failure = store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      source: "agent",
      text: `I could not send this to ${target.name}. ${error instanceof Error ? error.message : String(error)} Try again or name the teammate directly.`,
    });
    broadcast({ kind: "message", threadId: bot.threadId, message: failure });
    console.error(`semantic handoff to ${target.name} failed:`, error);
    return decision;
  }

  const status = store.appendMessage(bot.threadId, {
    role: "bot",
    kind: "text",
    source: "agent",
    text: `I sent this to ${target.name}. The result will appear here when it finishes.`,
  });
  broadcast({ kind: "message", threadId: bot.threadId, message: status });
  return decision;
}

const groupQueuedTurns = new Map<string, Array<{ text: string; groupId: string }>>();

function triggerProactive(botId: string, reason: ProactiveReason, context = "") {
  const bot = store.bot(botId);
  if (!bot || !shouldTriggerProactive(bot)) return;
  const reasons = proactivePending.get(botId) ?? new Set<ProactiveReason>();
  reasons.add(reason);
  proactivePending.set(botId, reasons);
  if (bot.busy || bot.operatorControl) return;
  proactivePending.delete(botId);
  void startTurn(botId, proactivePrompt(reason, context), {
    source: "proactive",
  }).catch(() => {});
}

/** Keep the task budget monotonic when parallel tool calls arrive with the
 * same serialized cursor. The cursor in a queued message remains sufficient
 * after a restart; this map closes only the in-process race. */
function authorizeTaskDelegation(context: TaskContext, fromBotId: string, targetBotId: string) {
  const used = taskMessageCounts.get(context.id);
  const current = used !== undefined && used > context.messages ? { ...context, messages: used } : context;
  const delegation = delegateTask(current, fromBotId, targetBotId);
  if (isTaskDelegation(delegation)) {
    taskMessageCounts.set(context.id, delegation.parent.messages);
    while (taskMessageCounts.size > 4096) {
      const oldest = taskMessageCounts.keys().next().value as string | undefined;
      if (!oldest) break;
      taskMessageCounts.delete(oldest);
    }
  }
  return delegation;
}

function queueAgentMessage(targetBotId: string, item: QueuedAgentMessage): number {
  const queue = agentInbox.get(targetBotId) ?? [];
  queue.push(item);
  agentInbox.set(targetBotId, queue);
  persistAgentInbox(agentInbox);
  return queue.length;
}

function drainAgentInbox(botId: string) {
  const target = store.bot(botId);
  const queue = agentInbox.get(botId);
  if (!target || target.busy || target.operatorControl || !queue?.length) return;
  const item = queue.shift()!;
  if (!queue.length) agentInbox.delete(botId);
  persistAgentInbox(agentInbox);
  const from = item.fromBotId ? store.bot(item.fromBotId) : null;
  const fromName = from?.name ?? "another bot";
  const prefixed = `[Queued message from @${fromName}, another bot in this NexBot workspace. Reply to them.]

${item.message}`;
  void startTurn(botId, prefixed, {
    taskContext: item.taskContext,
    source: "agent",
    fromBot: from ? { id: from.id, name: from.name, color: from.color } : undefined,
    chatText: item.message,
  }).catch((err) => {
    if (from) {
      const note = store.appendMessage(from.threadId, {
        role: "bot",
        kind: "activity",
        source: "agent",
        tool: { name: `@${target.name} could not start: ${String(err).slice(0, 120)}`, ok: false },
      });
      broadcast({ kind: "message", threadId: from.threadId, message: note });
    }
    setTimeout(() => drainAgentInbox(botId), 50);
  });
}

function chiefOfStaffBot() {
  return store.bots.find((b) => b.kind !== "group" && !b.hidden && /chief of staff/i.test(`${b.name} ${b.title}`)) ??
    store.bots.find((b) => b.kind !== "group" && !b.hidden && b.name.trim().toLowerCase() === "luna") ??
    null;
}

function scheduleCompletionReport() {
  if (cosReportTimer) return;
  cosReportTimer = setTimeout(() => {
    cosReportTimer = undefined;
    void flushCompletionReports();
  }, 250);
}

async function flushCompletionReports() {
  const cos = chiefOfStaffBot();
  if (!cos || completionReports.length === 0) return;
  if (cos.busy) {
    scheduleCompletionReport();
    return;
  }
  const reports = completionReports.splice(0, completionReports.length);
  const lines = reports.slice(-12).map((r) => `- @${r.name}: ${r.text.slice(0, 700)}`);
  const prompt = `[Completion report]

The following teammate task(s) finished. Send Charles a short status update. Mention concrete results, blockers, and decisions. Do not delegate the report back to the reporting agents.

${lines.join("\n")}`;
  try {
    await startTurn(cos.id, prompt, { source: "completion" });
    if (cos.notifications !== false) {
      broadcast({
        kind: "notify",
        botId: cos.id,
        title: "Chief of Staff",
        body: `${reports.length} teammate task${reports.length === 1 ? "" : "s"} completed.`,
      });
    }
  } catch {
    completionReports.unshift(...reports);
    scheduleCompletionReport();
  }
}

function enqueueCompletionReport(bot: ReturnType<typeof store.bot>, text: string) {
  if (!bot || bot.kind === "group" || bot.completionPings === false || !isMeaningfulUpdate(text)) return;
  const cos = chiefOfStaffBot();
  if (!cos || cos.id === bot.id) return;
  completionReports.push({ botId: bot.id, name: bot.name, text: text.trim(), at: Date.now() });
  while (completionReports.length > 20) completionReports.shift();
  scheduleCompletionReport();
}

// ── turn dispatch (upstream ProviderCommandReactor, miniature) ──────────
async function stopActiveTurn(botId: string, reason: string): Promise<void> {
  const bot = store.bot(botId);
  if (!bot) return;
  const instance = registry.get(bot.modelSelection.instanceId);
  try { await instance?.adapter.interruptTurn(bot.threadId); } catch {}
  const interruptedTurn = turnMeta.get(bot.id);
  if (interruptedTurn?.jobId) updateJob(interruptedTurn.jobId, { status: "interrupted", error: reason });
  for (const receipt of interruptReceipts(bot.id)) patchReceiptMessage(receipt);
  watchdog.end(bot.id);
  screens.stop(bot.id);
  turnGroup.delete(bot.id);
  turnMeta.delete(bot.id);
  turnTools.delete(bot.id);
  store.patchBot(bot.id, { busy: false });
  forgetTurn(bot.id);
  broadcast({ kind: "bot", bot: store.bot(bot.id) });
}

function drainUserQueue(botId: string): void {
  const bot = store.bot(botId);
  if (!bot || bot.busy || bot.operatorControl) return;
  const queued = takeNextTurn(botId);
  if (!queued) return;
  void startTurn(botId, queued.text, {
    clientNonce: queued.clientNonce,
    existingMessageId: queued.messageId,
    source: "user",
  }).catch(() => {
    const failed = store.patchMessage(bot.threadId, queued.messageId, { status: "failed" });
    if (failed) broadcast({ kind: "message.patch", threadId: bot.threadId, message: failed });
    setTimeout(() => drainUserQueue(botId), 50);
  });
}

async function startTurn(botId: string, text: string, opts?: StartTurnOpts) {
  const bot = store.bot(botId);
  if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (bot.operatorControl) throw Object.assign(new Error("operator takeover is active — release control before starting the bot"), { status: 409 });
  if (bot.busy) throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
  const existingJob = opts?.jobId ? getJob(opts.jobId) : null;
  if (opts?.jobId && (!existingJob || existingJob.botId !== bot.id)) {
    throw Object.assign(new Error("no such job for this bot"), { status: 404 });
  }
  const isResume = Boolean(opts?.resume && existingJob);
  const turnText = existingJob
    ? (text ? prepareReflexionPrompt({ ...existingJob, text }, store) : prepareReflexionPrompt(existingJob, store))
    : text;
  let taskContext = opts?.taskContext ?? (isResume ? existingJob?.taskContext : undefined) ?? createTaskContext(bot.id);

  if (bot.kind === "group") {
    const members = (bot.memberIds ?? []).map((id) => store.bot(id)).filter(Boolean) as NonNullable<ReturnType<typeof store.bot>>[];
    if (members.length < 2) throw Object.assign(new Error("a group needs 2 to 6 teammates"), { status: 400 });
    const userMessage = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: turnText, clientNonce: opts?.clientNonce });
    broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });

    const mentioned = mentionedBots(turnText, members);
    const targets = mentioned.length > 0 ? mentioned : members;

    for (const member of targets) {
      if (!member) continue;
       const promptText = `[Group @${bot.name}]\n\n${turnText}`;
      if (member.busy || member.operatorControl) {
        const existing = groupQueuedTurns.get(member.id) ?? [];
        existing.push({ text: promptText, groupId: bot.id });
        groupQueuedTurns.set(member.id, existing);
      } else {
        void startTurn(member.id, promptText, { taskContext: createTaskContext(member.id), source: "agent", groupId: bot.id }).catch(() => {});
      }
    }
    return;
  }

  let selection: ModelSelection = isResume && existingJob
    ? {
        instanceId: existingJob.providerInstanceId,
        model: existingJob.model,
        ...(existingJob.reasoningEffort ? { reasoningEffort: existingJob.reasoningEffort } : {}),
      }
    : bot.modelSelection;
  let instance = registry.get(selection.instanceId);
  if (!instance) {
    const fallback = await defaultSelection();
    const fallbackInstance = registry.get(fallback.instanceId);
    if (fallbackInstance) {
      selection = fallback;
      instance = fallbackInstance;
      if (bot.modelSelection.instanceId !== fallback.instanceId || bot.modelSelection.model !== fallback.model) {
        store.patchBot(bot.id, { modelSelection: fallback });
        broadcast({ kind: "bot", bot: store.bot(bot.id) });
      }
    } else {
      throw Object.assign(
        new Error("No AI provider is ready: the selected provider is unavailable. Install and sign in to a supported CLI, or configure an API provider in Settings."),
        { status: 409 },
      );
    }
  }

  if (!isResume && isChiefOfStaffRole(bot.name, bot.title)) {
    selection = chooseAntigravityCosSelection(selection, turnText);
  }

  const existingIncoming = opts?.existingMessageId
    ? store.messagesFor(bot.threadId).find((message) => message.id === opts.existingMessageId)
    : undefined;
  if (existingIncoming?.status === "pending") {
    const confirmed = store.patchMessage(bot.threadId, existingIncoming.id, { status: "confirmed" });
    if (confirmed) broadcast({ kind: "message.patch", threadId: bot.threadId, message: confirmed });
  }
  const incoming = isResume
    ? null
    : existingIncoming ?? (
        opts?.fromBot
          ? store.appendMessage(bot.threadId, {
              role: "bot",
              kind: "text",
              text: opts.chatText ?? turnText,
              fromBot: opts.fromBot,
              source: opts.source ?? "agent",
            })
          : store.appendMessage(bot.threadId, {
              role: "user",
              kind: "text",
              text: turnText,
              clientNonce: opts?.clientNonce,
              source: opts?.source ?? "user",
            })
      );
  if (incoming && !existingIncoming) broadcast({ kind: "message", threadId: bot.threadId, message: incoming });
  const turnKind: TurnKind = isResume && existingJob ? existingJob.source : opts?.source ?? (opts?.fromBot ? "agent" : "user");

  // Print-mode providers cannot receive the peer-agent MCP tools. Route a
  // clear Chief of Staff task in the harness so the user still gets normal
  // conversation while the right teammate does the work.
  const hasExplicitMention = mentionedBots(
    turnText,
    store.bots.filter((peer) => peer.id !== bot.id && !peer.hidden),
  ).length > 0;
  const canAutoRoute =
    incoming &&
    turnKind === "user" &&
    !isResume &&
    !opts?.replay &&
    !hasExplicitMention &&
    isChiefOfStaffRole(bot.name, bot.title);
  if (canAutoRoute) {
    store.patchBot(bot.id, { busy: true, unread: false });
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
    try {
      const routed = await autoRouteChiefTurn(bot, turnText, taskContext);
      if (routed) {
        store.patchBot(bot.id, { busy: false, unread: true });
        broadcast({ kind: "bot", bot: store.bot(bot.id) });
        enqueueConversationArchive(bot.id, store.messagesFor(bot.threadId));
        return;
      }
    } catch (error) {
      console.warn(`semantic routing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    store.patchBot(bot.id, { busy: false });
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
  }

  const job = existingJob
    ? updateJob(existingJob.id, {
        status: "running",
        attempt: existingJob.attempt + 1,
        error: undefined,
        text: turnText,
        taskContext,
        providerInstanceId: selection.instanceId,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        resumeCursor: isResume ? existingJob.resumeCursor : undefined,
        onComplete: opts?.onComplete ?? existingJob.onComplete,
        maxTokens: opts?.maxTokens ?? existingJob.maxTokens,
      })!
    : createJob({
        botId: bot.id,
        threadId: bot.threadId,
        messageId: incoming!.id,
        text: turnText,
        source: turnKind,
        taskContext,
        providerInstanceId: selection.instanceId,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        onComplete: opts?.onComplete,
        maxTokens: opts?.maxTokens,
      });
  turnMeta.set(bot.id, {
    kind: turnKind,
    messageStart: incoming ? Math.max(0, store.messagesFor(bot.threadId).findIndex((message) => message.id === incoming.id)) : store.messagesFor(bot.threadId).length,
    startedAt: Date.now(),
    sourceBotId: opts?.fromBot?.id,
    jobId: job.id,
    relayResult: opts?.relayResult,
  });

  // The active replay window stays small; the full transcript is durable.

  ensureDesk(bot.id);
  ensureMemory(bot.id);
  const builtPersona = buildPersona(bot, {
    desk: deskPrompt(bot.id),
    memory: bot.memoryEnabled ? `${memoryPrompt(bot.id)}${memoryFactsPrompt(bot.id)}` : "",
    skills: skillsPrompt(bot.enabledSkillSlugs),
  });
  const persona = withRolePrompt(bot, builtPersona);

  // busy flips immediately so the composer locks; the dispatch itself runs
  // in the background — box provisioning can take ~90s and must never
  // hang the HTTP request
  store.patchBot(bot.id, { busy: true, unread: false });
  watchdog.start(bot.id);
  if (opts?.groupId) turnGroup.set(bot.id, opts.groupId);
  if (turnKind === "user" && !isResume && !opts?.replay) rememberTurn(bot.id, turnText, "user");
  broadcast({ kind: "bot", bot: store.bot(bot.id) });

  if (!isResume && !opts?.replay && turnKind === "user") {
    let mentionTask = taskContext;
    for (const peer of mentionedBots(
      text,
      store.bots.filter((b) => b.id !== bot.id && !b.hidden),
    )) {
      if (isForbiddenFightAsk(bot, peer, text)) continue;
      const delegation = authorizeTaskDelegation(mentionTask, bot.id, peer.id);
      if (!isTaskDelegation(delegation)) continue;
      mentionTask = delegation.parent;
      appendHandoff({
        from: { id: bot.id, name: bot.name, color: bot.color },
        to: { id: peer.id, name: peer.name, color: peer.color },
        text,
      });
      const cos = chiefOfStaffBot();
      if (cos && cos.id !== bot.id && cos.id !== peer.id) {
        triggerProactive(cos.id, "task-queued", `@${bot.name} assigned work to @${peer.name}: ${text.slice(0, 500)}`);
      }
      if (!peer.busy) {
        void startTurn(peer.id, `[Team job from the user, also sent to @${bot.name}]\n\n${text}`, {
          taskContext: delegation.child,
          source: "agent",
        }).catch(() => {});
      }
    }
    taskContext = mentionTask;
  }

  const routingSuggestions =
    turnKind === "user" && !isResume && !opts?.replay && isChiefOfStaffRole(bot.name, bot.title)
      ? suggestSpecialistRoutes(
          turnText,
          store.bots.filter((peer) => peer.id !== bot.id && !peer.hidden),
        )
      : [];
  const deterministicRouting = routingDirective(routingSuggestions);

  void (async () => {
    try {
      const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};
      if (cfg.composio?.key) integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
      // NexBot has no cloud computer. Local CUA only, unless the bot is Off.
      const wants = bot.computer;
      if (wants !== "off") {
        const cua = readCuaConnection();
        if (cua) integrations.localComputer = localComputerIntegration(bot.id, cua);
      }
      // Every active bot on a peer-agent capable driver gets the same tools.
      // The task context limits delegation depth, rejects cycles, and bounds
      // total messages. A bot that reaches the hop limit can still finish its
      // own task.
      if (
        turnKind !== "completion" &&
        taskContext.hops < taskContext.maxHops &&
        taskContext.messages < taskContext.maxMessages &&
        instance.adapter.capabilities.agentsMcp === true &&
        store.bots.filter((b) => b.id !== bot.id && !b.hidden).length > 0
      ) {
        integrations.agents = agentsIntegration(bot.id, taskContext);
      }
      integrations.todos = todosIntegration(bot.id);
      if (instance.adapter.capabilities.agentsMcp === true && credentialsForBot(bot.id).length > 0) {
        integrations.credentials = credentialsIntegration(bot.id);
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit delegation nudge — the agent still does the ask_bot call
      // itself, so the harness stays the single owner of turns/permissions
      const tagged = mentionedBots(
        turnText,
        store.bots.filter((b) => b.id !== bot.id),
      );
      const transcriptMessages = isResume && existingJob
        ? store.messagesFor(bot.threadId).filter((message) => message.id !== existingJob.messageId)
        : store.messagesFor(bot.threadId);
      const antigravity = selection.instanceId === "antigravity";
      const antigravityBudget = 60_000;
      // Keep an agy conversation alive while its provider-side context stays
      // small. Once usage crosses the budget, start a fresh session with the
      // recent window plus the durable archive path below.
      const savedAntigravityCursor = antigravity && Number(bot.usage?.input ?? 0) < antigravityBudget
        ? bot.resumeCursors?.[selection.instanceId]
        : undefined;
      const providerResumeCursor = isResume
        ? existingJob?.resumeCursor
        : savedAntigravityCursor;
      const freshContext = antigravity && !providerResumeCursor
        ? (ensureConversationArchive(bot.id, transcriptMessages), freshSessionContextPrompt(bot.id, transcriptMessages))
        : "";

      const staticSystem = [
        persona,
        integrations.localComputer
          ? "You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
          : "",
        integrations.agents
          ? "You can work with the user's other bots through the agents tools. Every bot with peer-agent tools can coordinate from its active task. list_bots shows who's available, ask_bot waits for a peer reply, send_bot queues work, search_history searches past receipts, and save_memory/get_memory records durable facts and notes. The Chief of Staff coordinates the global queue, but specialists can delegate within their task scope. There is only one Chief of Staff — never create a second. Fight X / challenge X means use or spawn a specialist that critiques X's existing output; never ask_bot X to write the critique of itself."
          : "",
        integrations.composio
          ? "Connected apps via Composio are available as tools. Use them when they fit."
          : "",
        integrations.todos
          ? "You have a todo tool — a durable checklist for this job. Update it as you work; keep one item in_progress."
          : "",
        integrations.credentials
          ? "You have a per-bot credential vault. list_credentials shows only grants for this bot. fill_credential types a granted secret into the focused local field without returning the secret to you."
          : "",
        SLEEP_WARNING,
      ]
        .filter(Boolean)
        .join(" ");

      const dynamicSystem = [
        integrations.agents
          ? `The current task allows ${taskContext.maxHops - taskContext.hops} more delegation hop(s) and ${taskContext.maxMessages - taskContext.messages} more message(s); do not delegate to a bot already in the task path.`
          : "",
        integrations.agents ? deterministicRouting : "",
        freshContext,
        tagged.length
          ? `The user also sent this job in parallel to ${tagged
              .map((t) => `@${t.name}`)
              .join(" and ")}. Coordinate if needed; do not wait for them unless you must.`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const systemPrompt = dynamicSystem ? `${staticSystem}\n\n${dynamicSystem}` : staticSystem;

      await instance.adapter.sendTurn({
        threadId: bot.threadId,
        botId: bot.id,
        text: turnText,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        resumeCursor: providerResumeCursor,
        transcript: clipForTurn(transcriptMessages, antigravity ? { window: 10, textCap: 2_000 } : undefined),
        system: systemPrompt,
        integrations,
      });
      /* no cloud-box screen poller — local frames come from Electron */
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateJob(job.id, { status: "failed", error: message.slice(0, 500) });
      const failure = store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
      });
      broadcast({ kind: "message", threadId: bot.threadId, message: failure });
      store.patchBot(bot.id, { busy: false });
      watchdog.end(bot.id);
      turnGroup.delete(bot.id);
      turnMeta.delete(bot.id);
      forgetTurn(bot.id);
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      if (queuedTurns(bot.id).length > 0) setTimeout(() => drainUserQueue(bot.id), 50);
      else setTimeout(() => drainAgentInbox(bot.id), 50);
    }
  })();
}

/** Rebuild the provider fleet after a config change so new keys take
 * effect without a server restart (kills any in-flight turns). */
async function reloadProviders() {
  bus.detachAll();
  await registry.disposeAll();
  await registry.load(instanceConfigs(cfg));
  bus.attach(registry.instances());
}

// ── HTTP surface ───────────────────────────────────────────────────────
const pairingAttemptWindows = new Map<string, { startedAt: number; count: number }>();
const PAIRING_ATTEMPT_WINDOW_MS = 60_000;
const PAIRING_ATTEMPT_LIMIT = 10;

function allowPairingAttempt(req: IncomingMessage): boolean {
  const key = req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const current = pairingAttemptWindows.get(key);
  if (!current || now - current.startedAt >= PAIRING_ATTEMPT_WINDOW_MS) {
    pairingAttemptWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= PAIRING_ATTEMPT_LIMIT) return false;
  current.count += 1;
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  try {
    const providedToken = tokenFromHarnessRequest(req.headers.authorization, url.searchParams.get("token"));
    // Connect device tokens authorize the same API surface as the host
    // harness, but only while LAN mode (or an explicit off-loopback bind) is
    // active. Loopback clients remain trusted by the existing harness gate.
    const remoteDevice = remoteAccessEnabled(cfg, BIND) ? authenticateRemoteToken(providedToken) : null;
    const gate = authorizeHarnessRequest(req, method, path, providedToken, checkSteerToken(providedToken));
    const isPairingExchange = method === "POST" && path === "/api/remote-access/pair";
    if (!gate.ok && !remoteDevice && !isPairingExchange) return json(res, 401, { error: gate.error });

    // ── internal peer-agent comms (localhost + shared token only) ──────
    // The agents-proxy (spawned inside a bot's agent process) calls these to
    // discover peers and hand a message to one. Not part of the public API.
    if (path.startsWith("/api/internal/")) {
      if (req.headers.authorization !== `Bearer ${COMMS_TOKEN}`) {
        return json(res, 401, { error: "unauthorized" });
      }
      if (method === "GET" && path === "/api/internal/agents") {
        const self = url.searchParams.get("self");
        const bots = store.bots
          .filter((b) => b.id !== self && !b.hidden)
          .map((b) => ({
            id: b.id,
            name: b.name,
            title: b.title,
            description: b.description,
            enabledSkillSlugs: b.enabledSkillSlugs ?? [],
            model: b.modelSelection.model,
            busy: !!b.busy,
          }));
        return json(res, 200, { bots });
      }
      if (method === "POST" && path === "/api/internal/ask-bot") {
        const body = await readBody(req);
        const fromBotId = String(body.fromBotId ?? "").trim();
        const toBotId = String(body.toBotId ?? "").trim();
        const message = String(body.message ?? "").trim();
        if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
        const taskContext = parseTaskContext(body.taskContext);
        if (!fromBotId || !taskContext) return json(res, 400, { error: "a valid taskContext is required" });
        const target = store.bot(toBotId);
        if (!target || target.hidden) return json(res, 404, { error: "no such bot" });
        const from = store.bot(fromBotId);
        if (!from || from.hidden) return json(res, 404, { error: "no such sender bot" });
        if (target.busy || target.operatorControl) return json(res, 200, { busy: true, taskContext });
        if (isForbiddenFightAsk(from, target, message)) {
          return json(res, 200, {
            error: "Fight/challenge X cannot ask_bot X. Critique their existing output, or spawn a specialist.",
          });
        }
        const delegation = authorizeTaskDelegation(taskContext, from.id, target.id);
        if (!isTaskDelegation(delegation)) return json(res, 200, { error: delegation.error, taskContext });
        const fromName = from?.name ?? "another bot";
        appendHandoff({
          from: from ? { id: from.id, name: from.name, color: from.color } : null,
          to: { id: target.id, name: target.name, color: target.color },
          text: message,
        });
        if (from) {
          const note = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: `asked @${target.name}: ${message.slice(0, 80)}` },
          });
          broadcast({ kind: "message", threadId: from.threadId, message: note });
          for (const g of store.bots.filter(
            (b) => b.kind === "group" && b.memberIds?.includes(from.id) && b.memberIds.includes(target.id),
          )) {
            const shared = store.appendMessage(g.threadId, {
              role: "bot",
              kind: "activity",
              tool: { name: `@${fromName} → @${target.name}` },
            });
            broadcast({ kind: "message", threadId: g.threadId, message: shared });
          }
        }
        const prefixed = `[Message from @${fromName}, another bot in this NexBot workspace. Reply to them.]\n\n${message}`;
        const reply = await askBotAndWait(fromBotId, toBotId, prefixed, delegation.child, {
          fromBot: from ? { id: from.id, name: from.name, color: from.color } : undefined,
          chatText: message,
        });
        const noTurn =
          reply === "(no such bot)" ||
          reply.startsWith("(couldn't start that bot:") ||
          reply === ASK_BOT_STILL_WORKING;
        if (from && reply && !noTurn) {
          const bubble = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "text",
            text: reply,
            fromBot: { id: target.id, name: target.name, color: target.color },
          });
          broadcast({ kind: "message", threadId: from.threadId, message: bubble });
        }
        return json(res, 200, { botName: target.name, text: reply, taskContext: delegation.parent });
      }
      if (method === "POST" && path === "/api/internal/send-bot") {
        const body = await readBody(req);
        const fromBotId = String(body.fromBotId ?? "").trim();
        const toBotId = String(body.toBotId ?? "").trim();
        const message = String(body.message ?? "").trim();
        if (!toBotId || !message) return json(res, 400, { error: "toBotId and message required" });
        const taskContext = parseTaskContext(body.taskContext);
        if (!fromBotId || !taskContext) return json(res, 400, { error: "a valid taskContext is required" });
        const target = store.bot(toBotId);
        if (!target || target.hidden) return json(res, 404, { error: "no such bot" });
        const from = store.bot(fromBotId);
        if (!from || from.hidden) return json(res, 404, { error: "no such sender bot" });
        if (isForbiddenFightAsk(from, target, message)) {
          return json(res, 200, { error: "Fight/challenge X cannot ask_bot X. Critique their existing output, or spawn a specialist." });
        }
        const delegation = authorizeTaskDelegation(taskContext, from.id, target.id);
        if (!isTaskDelegation(delegation)) return json(res, 200, { error: delegation.error, taskContext });
        const fromName = from?.name ?? "another bot";
        appendHandoff({
          from: from ? { id: from.id, name: from.name, color: from.color } : null,
          to: { id: target.id, name: target.name, color: target.color },
          text: message,
        });
        if (from) {
          const note = store.appendMessage(from.threadId, {
            role: "bot",
            kind: "activity",
            source: "agent",
            tool: { name: `sent @${target.name}: ${message.slice(0, 80)}` },
          });
          broadcast({ kind: "message", threadId: from.threadId, message: note });
          for (const g of store.bots.filter(
            (b) => b.kind === "group" && b.memberIds?.includes(from.id) && b.memberIds.includes(target.id),
          )) {
            const shared = store.appendMessage(g.threadId, {
              role: "bot",
              kind: "activity",
              source: "agent",
              tool: { name: `@${fromName} → @${target.name}` },
            });
            broadcast({ kind: "message", threadId: g.threadId, message: shared });
          }
        }
        const position = queueAgentMessage(target.id, { fromBotId: from.id, message, taskContext: delegation.child, at: Date.now() });
        drainAgentInbox(target.id);
        const cos = chiefOfStaffBot();
        if (cos && cos.id !== from?.id && cos.id !== target.id) {
          triggerProactive(cos.id, "task-queued", `@${fromName} queued work for @${target.name}: ${message.slice(0, 500)}`);
        }
        return json(res, 202, { queued: true, position, botName: target.name, busy: !!target.busy, taskContext: delegation.parent });
      }
      if (method === "POST" && path === "/api/internal/todos") {
        const body = await readBody(req);
        const botId = String(body.botId ?? "").trim();
        if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
        const result = applyTodoTool(botId, "items" in body ? { items: body.items as any[] } : {});
        return json(res, 200, result);
      }
      if (method === "GET" && path === "/api/internal/operator") {
        const botId = (url.searchParams.get("botId") ?? "").trim();
        const bot = store.bot(botId);
        if (!bot) return json(res, 404, { error: "no such bot" });
        return json(res, 200, { active: Boolean(bot.operatorControl) });
      }
      if (method === "GET" && path === "/api/internal/credentials") {
        const botId = (url.searchParams.get("botId") ?? "").trim();
        if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
        return json(res, 200, { credentials: credentialsForBot(botId) });
      }
      const internalCredential = path.match(/^\/api\/internal\/credentials\/([\w-]+)\/reveal$/);
      if (method === "GET" && internalCredential) {
        const botId = (url.searchParams.get("botId") ?? "").trim();
        if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
        const credential = revealGrantedCredential(internalCredential[1], botId);
        if (!credential) return json(res, 403, { error: "credential is not granted to this bot" });
        return json(res, 200, credential);
      }
      if (method === "GET" && path === "/api/internal/search") {
        const q = (url.searchParams.get("q") ?? "").trim();
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 10)));
        if (!q) return json(res, 400, { error: "q required" });
        const messageResults = searchMessages(q, limit).map((hit) => {
          const bot = hit.botId ? store.bot(hit.botId) : store.botByThread(hit.threadId);
          return { ...hit, botId: bot?.id ?? hit.botId, botName: bot?.name };
        });
        const factResults = searchMemoryFacts(q, { limit }).map((fact) => {
          const bot = store.bot(fact.botId);
          return {
            messageId: `memory:${fact.id}`,
            threadId: bot?.threadId ?? fact.botId,
            botId: fact.botId,
            botName: bot?.name,
            text: fact.fact,
            at: fact.sourceAt,
            provenance: { sourceType: fact.sourceType, sourceId: fact.sourceId, sourceAt: fact.sourceAt, confidence: fact.confidence },
          };
        });
        const results = [...factResults, ...messageResults].sort((a, b) => b.at - a.at).slice(0, limit);
        return json(res, 200, { results, retrieval: "structured-memory + transcript-fts" });
      }
      if (method === "GET" && path === "/api/internal/memory") {
        const botId = (url.searchParams.get("botId") ?? "").trim();
        if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
        const profile = readProfile(botId).trim();
        const log = readLog(botId).trim();
        const facts = listMemoryFacts(botId);
        const factText = facts.length
          ? facts.map((fact) => `- ${fact.fact} [${fact.sourceType}:${fact.sourceId}; ${new Date(fact.sourceAt).toISOString()}]`).join("\n")
          : "(empty)";
        const text = `# Memory for ${store.bot(botId)?.name ?? "Bot"}\n\n## Structured facts\n${factText}\n\n## profile.md\n${profile || "(empty)"}\n\n## Current Month Log\n${log || "(empty)"}`;
        return json(res, 200, { text, profile, log, facts });
      }
      if (method === "POST" && path === "/api/internal/memory") {
        const body = await readBody(req);
        const botId = String(body.botId ?? "").trim();
        const target = String(body.target ?? "log").trim();
        const content = String(body.content ?? "").trim();
        const mode = String(body.mode ?? (target === "log" ? "append" : "replace")).trim();
        if (!botId || !store.bot(botId)) return json(res, 404, { error: "no such bot" });
        if (!content) return json(res, 400, { error: "content required" });
        const sourceAt = Number.isFinite(Number(body.sourceAt)) ? Number(body.sourceAt) : Date.now();
        const currentJobId = turnMeta.get(botId)?.jobId;
        saveMemoryFact({
          botId,
          fact: content,
          kind: body.kind === "preference" || body.kind === "procedure" || body.kind === "event" ? body.kind : target === "log" ? "event" : "fact",
          sourceType: body.sourceType === "user" || body.sourceType === "tool" || body.sourceType === "import" || body.sourceType === "system" ? body.sourceType : "assistant",
          sourceId: String(body.sourceId ?? currentJobId ?? `memory:${Date.now()}`).slice(0, 240),
          sourceAt,
          validFrom: Number.isFinite(Number(body.validFrom)) ? Number(body.validFrom) : undefined,
          validUntil: Number.isFinite(Number(body.validUntil)) ? Number(body.validUntil) : undefined,
          confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 0.8,
        });

        if (target === "profile") {
          const current = mode === "append" ? readProfile(botId) : "";
          const next = mode === "append" ? (current ? `${current}\n\n${content}` : content) : content;
          if (next.length > MEMORY_FILE_MAX) {
            return json(res, 400, { error: `profile exceeds ${MEMORY_FILE_MAX} byte limit` });
          }
          writeProfile(botId, next);
          return json(res, 200, { text: `Updated profile.md (${next.length} bytes).` });
        } else if (target === "log") {
          const current = mode === "replace" ? "" : readLog(botId);
          const next = mode === "replace" ? content : (current ? `${current}\n\n- ${new Date().toISOString()}: ${content}` : `- ${new Date().toISOString()}: ${content}`);
          if (next.length > MEMORY_FILE_MAX) {
            return json(res, 400, { error: `log exceeds ${MEMORY_FILE_MAX} byte limit` });
          }
          if (mode === "replace") writeLog(botId, next);
          else appendLog(botId, `\n\n- ${new Date().toISOString()}: ${content}`);
          return json(res, 200, { text: `Saved to dated log (${next.length} bytes).` });
        } else {
          return json(res, 400, { error: "target must be 'profile' or 'log'" });
        }
      }
      return json(res, 404, { error: "unknown internal endpoint" });
    }

    // ── events stream ──
    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
      sseClients.add(res);
      const keepalive = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {}
      }, 25_000);
      req.on("close", () => {
        clearInterval(keepalive);
        sseClients.delete(res);
      });
      return;
    }

    // ── bots ──
    if (method === "GET" && path === "/api/bots") {
      return json(res, 200, {
        bots: store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId), todos: listTodos(b.id) })),
      });
    }
    const botPathMatch = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (method === "GET" && botPathMatch) {
      const bot = store.bot(botPathMatch[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { bot: { ...bot, messages: store.messagesFor(bot.threadId), todos: listTodos(bot.id) } });
    }
    if (method === "POST" && path === "/api/onboarding/chief-of-staff") {
      const body = await readBody(req).catch((): Record<string, unknown> => ({}));
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      const job = typeof body.job === "string" ? body.job.trim().slice(0, 500) : "";
      if (!name) return json(res, 400, { error: "Chief of Staff name required" });
      if (!job) return json(res, 400, { error: "Chief of Staff job required" });

      let bot = chiefOfStaffBot();
      if (bot) {
        bot = store.patchBot(bot.id, { name, title: "Chief of Staff", description: job });
      } else {
        bot = store.createBot({
          name,
          title: "Chief of Staff",
          description: job,
          modelSelection: await defaultSelection(),
        });
      }
      if (!bot) return json(res, 500, { error: "could not set up Chief of Staff" });

      const messages = store.messagesFor(bot.threadId);
      const greeting = messages.find((message) => message.role === "bot" && message.kind === "text");
      if (greeting) {
        const patchedGreeting = store.patchMessage(bot.threadId, greeting.id, {
          text: teammateGreeting(name, job),
        });
        if (patchedGreeting) broadcast({ kind: "message.patch", threadId: bot.threadId, message: patchedGreeting });
      }
      const setupCard = messages.find(
        (message) => message.kind === "options" && /^What is this (?:NexBot|teammate)'s job\?$/.test(message.card?.title ?? ""),
      );
      if (setupCard?.card) {
        const patchedCard = store.patchMessage(bot.threadId, setupCard.id, {
          card: { ...setupCard.card, answered: job, dismissed: true },
        });
        if (patchedCard) broadcast({ kind: "message.patch", threadId: bot.threadId, message: patchedCard });
      }
      broadcast({ kind: "bot", bot });
      return json(res, 200, { bot: { ...bot, messages: store.messagesFor(bot.threadId) } });
    }
    if (method === "POST" && path === "/api/wipe") {
      const expected = wipePassword();
      if (!expected) return json(res, 503, { error: "wipe password is not configured" });
      const body = await readBody(req).catch((): Record<string, unknown> => ({}));
      if (!secretsMatch(expected, wipeHeader(req))) return json(res, 401, { error: "invalid wipe password" });
      if (body.confirmation !== "WIPE") return json(res, 400, { error: "type WIPE to confirm" });

      const bots = [...store.bots];
      await Promise.all(
        bots.map(async (bot) => {
          await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
          screens.stop(bot.id);
        }),
      );
      if (cosReportTimer) clearTimeout(cosReportTimer);
      cosReportTimer = undefined;
      turnGroup.clear();
      turnMeta.clear();
      turnTools.clear();
      toolMessageByItem.clear();
      askMessageByRequest.clear();
      proactivePending.clear();
      taskMessageCounts.clear();
      completionReports.length = 0;
      agentInbox.clear();
      const summary = wipeLocalData();
      store.clearAll();
      syncFileWatches();
      persistAgentInbox(agentInbox);
      for (const bot of bots) broadcast({ kind: "bot.deleted", botId: bot.id });
      broadcast({ kind: "routines", routines: [] });
      broadcast({ kind: "wipe", summary });
      return json(res, 200, { ok: true, summary });
    }
    if (method === "POST" && path === "/api/bots") {
      const body = await readBody(req).catch((): Record<string, unknown> => ({}));
      const kind = body.kind === "group" ? "group" : "bot";
      const color = typeof body.color === "string" && ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"].includes(body.color)
        ? body.color as NexColor
        : undefined;
      const memberIds: string[] = Array.isArray(body.memberIds)
        ? [...new Set((body.memberIds as unknown[]).map((id) => String(id)))]
        : [];
      if (kind === "group") {
        const invalid = groupMemberError(memberIds);
        if (invalid) return json(res, 400, { error: invalid });
      }
      let modelSelection = await defaultSelection();
      const requested = body.modelSelection as { instanceId?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined;
      if (requested && typeof requested === "object") {
        const instanceId = typeof requested.instanceId === "string" ? requested.instanceId : "";
        const model = typeof requested.model === "string" ? requested.model : "";
        const instance = (await registry.describe()).find((item) => item.instanceId === instanceId);
        if (!instance || instance.snapshot.state !== "available") {
          return json(res, 400, { error: "selected provider is unavailable" });
        }
        if (!instance.models.options.some((option) => option.id === model)) {
          return json(res, 400, { error: "selected model is unavailable" });
        }
        const reasoningEffort = requested.reasoningEffort === undefined ? undefined : normalizeReasoningEffort(requested.reasoningEffort);
        if (requested.reasoningEffort !== undefined && !reasoningEffort) {
          return json(res, 400, { error: "reasoningEffort must be auto, low, medium, high, or max" });
        }
        modelSelection = { instanceId, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
      }
      const bot = store.createBot({
        kind,
        name: typeof body.name === "string" ? body.name : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        personality: typeof body.personality === "string" ? body.personality : undefined,
        color,
        memberIds,
        modelSelection,
      });
      const created = store.bot(bot.id)!;
      broadcast({ kind: "bot", bot: created });
      return json(res, 201, { bot: { ...created, messages: store.messagesFor(bot.threadId) } });
    }
    let m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const existing = store.bot(m[1]);
      if (!existing) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      if (body.kind !== undefined && body.kind !== existing.kind) {
        return json(res, 400, { error: "kind cannot be changed" });
      }
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "title", "description", "personality", "notifications", "modelSelection", "unread", "computer", "color", "mascotExpression", "pinned", "hidden", "memoryEnabled", "enabledSkillSlugs", "memberIds", "proactiveEnabled", "completionPings", "sortOrder", "operatorControl"] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (patch.memberIds !== undefined) {
        if (existing.kind !== "group") {
          return json(res, 400, { error: "memberIds is only for groups" });
        }
        if (!Array.isArray(patch.memberIds)) {
          return json(res, 400, { error: "memberIds must be an array" });
        }
        const ids = [...new Set(patch.memberIds.map(String))];
        const invalid = groupMemberError(ids);
        if (invalid) return json(res, 400, { error: invalid });
        patch.memberIds = ids;
      }
      // Hidden bots drop off jobs/ask_bot. CoS must stay reachable — same
      // seat as last-CoS DELETE 409. Specialists can hide; user chat still works.
      if (patch.hidden && store.isLastChiefOfStaff(existing.id)) {
        return json(res, 400, { error: "cannot hide the Chief of Staff" });
      }
      const bot = store.patchBot(m[1], patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      broadcast({ kind: "bot", bot });
      return json(res, 200, { bot });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (store.isLastChiefOfStaff(bot.id)) {
        return json(res, 409, { error: "cannot delete the last Chief of Staff" });
      }
      // a running turn dies with its bot
      await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
      screens.stop(bot.id);
      store.deleteBot(bot.id);
      removeQueuedTurnsForBot(bot.id);
      agentInbox.delete(bot.id);
      persistAgentInbox(agentInbox);
      deleteRoutinesForBot(bot.id);
      syncFileWatches();
      for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
        try {
          unlinkSync(join(dir, `${bot.threadId}.ndjson`));
        } catch {}
      }
      broadcast({ kind: "bot.deleted", botId: bot.id });
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 200, { ok: true });
    }

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
      const body = await readBody(req);
      const patched = store.patchMessage(bot.threadId, m[2], {
        card: {
          ...existing.card,
          ...(typeof body.answered === "string" ? { answered: body.answered } : {}),
          ...(typeof body.dismissed === "boolean" ? { dismissed: body.dismissed } : {}),
        },
      });
      if (typeof body.answered === "string") {
        const role = roleByTitle(body.answered);
        if (role) {
          store.patchBot(bot.id, { title: role.title, description: role.description, name: bot.name === "New Bot" ? role.name : bot.name });
          broadcast({ kind: "bot", bot: store.bot(bot.id) });
        }
      }
      broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
      return json(res, 200, { message: patched });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const clientNonce = typeof body.clientNonce === "string" ? body.clientNonce.trim() : undefined;
      if (clientNonce && nonceCache.isDuplicate(m[1], clientNonce)) {
        return json(res, 200, { ok: true, duplicate: true });
      }
      let text = String(body.text ?? "").trim();
      const files = Array.isArray(body.files) ? body.files : [];
      if (files.length) {
        ensureDesk(m[1]);
        for (const f of files) {
          try {
            // Composer sends base64 `data` only. A raw `path` would copy any
            // file the harness can read (config, environ) into the bot inbox.
            if (typeof f?.data === "string" && f.data) {
              writeInboxFile(m[1], String(f.name ?? "file"), Buffer.from(f.data, "base64"));
            }
          } catch {}
        }
        text = `${text}\n\nAttached files are in ${inboxPath(m[1])}.`.trim();
      }
      if (!text) return json(res, 400, { error: "text required" });
      const delivery = body.delivery === "steer" || body.delivery === "replace" ? body.delivery : "queue";
      if (!registry.get(bot.modelSelection.instanceId)) {
        const fallback = await defaultSelection();
        if (!registry.get(fallback.instanceId)) {
          return json(res, 409, { error: "No AI provider is ready: the selected provider is unavailable." });
        }
      }
      nonceCache.record(m[1], clientNonce);
      if (bot.busy || bot.operatorControl) {
        if (delivery === "replace") {
          if (bot.operatorControl) {
            nonceCache.forget(m[1], clientNonce);
            return json(res, 409, { error: "operator takeover is active — release control before replacing the turn" });
          }
          await stopActiveTurn(bot.id, "turn replaced by the user");
        } else {
          const pending = store.appendMessage(bot.threadId, {
            role: "user",
            kind: "text",
            text,
            clientNonce,
            source: "user",
            status: "pending",
          });
          broadcast({ kind: "message", threadId: bot.threadId, message: pending });
          const queued = enqueueTurn({ botId: bot.id, text, messageId: pending.id, clientNonce, delivery });
          return json(res, 202, { ok: true, queued: true, delivery, queueId: queued.id, position: queuedTurns(bot.id).findIndex((row) => row.id === queued.id) + 1, clientNonce });
        }
      }
      try {
        await startTurn(m[1], text, { clientNonce });
      } catch (err) {
        nonceCache.forget(m[1], clientNonce);
        throw err;
      }
      return json(res, 202, { ok: true, clientNonce });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const instance = registry.get(bot.modelSelection.instanceId);
      if (!instance) return json(res, 409, { error: "provider unavailable" });
      await instance.adapter.respondToRequest(bot.threadId, String(body.requestId), {
        behavior: body.behavior === "allow" || body.behavior === "deny" || body.behavior === "answer" ? body.behavior : "answer",
        message: typeof body.message === "string" ? body.message : undefined,
      });
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      await stopActiveTurn(bot.id, "turn interrupted by the user");
      if (queuedTurns(bot.id).length > 0) setTimeout(() => drainUserQueue(bot.id), 50);
      else setTimeout(() => drainAgentInbox(bot.id), 50);
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/artifacts") {
      return serveArtifact(res, url.searchParams.get("path"));
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/takeover$/);
    if (m && (method === "POST" || method === "DELETE")) {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body: Record<string, unknown> = method === "POST" ? await readBody(req).catch(() => ({})) : {};
      const active = method === "POST" ? body.active !== false : false;
      if (active && bot.busy) await stopActiveTurn(bot.id, "operator takeover");
      const updated = store.patchBot(bot.id, { operatorControl: active });
      broadcast({ kind: "bot", bot: updated });
      if (!active) {
        setTimeout(() => {
          if (queuedTurns(bot.id).length > 0) return drainUserQueue(bot.id);
          const groupQueue = groupQueuedTurns.get(bot.id);
          if (groupQueue?.length) {
            groupQueuedTurns.delete(bot.id);
            const mergedText = groupQueue.map((item) => item.text).join("\n\n---\n\n");
            void startTurn(bot.id, mergedText, { taskContext: createTaskContext(bot.id), source: "agent", groupId: groupQueue[0]?.groupId }).catch(() => {});
            return;
          }
          drainAgentInbox(bot.id);
        }, 50);
      }
      return json(res, 200, { ok: true, active });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/queue$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { turns: queuedTurns(bot.id) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/preview$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const png = String(body.png ?? "");
      if (!png) return json(res, 400, { error: "png required" });
      for (const receipt of observeFrame(bot.id, png)) patchReceiptMessage(receipt);
      broadcast({ kind: "screen", botId: bot.id, png, mime: String(body.mime ?? "image/png") });
      return json(res, 200, { ok: true });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/memory$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      ensureMemory(bot.id);
      const profile = readProfile(bot.id);
      const log = readLog(bot.id);
      const baseHash = createHash("sha256").update(profile + "\n" + log).digest("hex");
      res.setHeader("etag", `"${baseHash}"`);
      return json(res, 200, {
        enabled: Boolean(bot.memoryEnabled),
        profile,
        log,
        text: profile,
        baseHash,
        dir: memoryDir(bot.id),
        desk: deskPath(bot.id),
      });
    }
    if (m && method === "PUT") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      ensureMemory(bot.id);
      const currentProfile = readProfile(bot.id);
      const currentLog = readLog(bot.id);
      const currentHash = createHash("sha256").update(currentProfile + "\n" + currentLog).digest("hex");

      const body = await readBody(req);
      const ifMatch = typeof req.headers["if-match"] === "string" ? req.headers["if-match"].replace(/^"|"$/g, "") : undefined;
      const providedHash = typeof body.baseHash === "string" ? body.baseHash : ifMatch;

      if (providedHash && providedHash !== currentHash) {
        return json(res, 409, {
          error: "memory was modified by another turn — reload before saving (CAS conflict)",
          currentHash,
        });
      }

      const profileText = typeof body.profile === "string" ? body.profile : typeof body.text === "string" ? body.text : undefined;
      const logText = typeof body.log === "string" ? body.log : undefined;
      if ((profileText && profileText.length > MEMORY_FILE_MAX) || (logText && logText.length > MEMORY_FILE_MAX)) {
        return json(res, 400, { error: "memory text too large" });
      }
      if (profileText !== undefined) writeProfile(bot.id, profileText);
      if (logText !== undefined) writeLog(bot.id, logText);
      if (body.enabled !== undefined) store.patchBot(bot.id, { memoryEnabled: Boolean(body.enabled) });
      const next = store.bot(bot.id)!;
      broadcast({ kind: "bot", bot: next });
      const profile = readProfile(bot.id);
      const log = readLog(bot.id);
      const nextHash = createHash("sha256").update(profile + "\n" + log).digest("hex");
      res.setHeader("etag", `"${nextHash}"`);
      return json(res, 200, {
        enabled: Boolean(next.memoryEnabled),
        profile,
        log,
        text: profile,
        baseHash: nextHash,
        dir: memoryDir(bot.id),
        desk: deskPath(bot.id),
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/todos$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { items: listTodos(bot.id) });
    }
    if (m && method === "PUT") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const result = applyTodoTool(bot.id, { items: Array.isArray(body.items) ? body.items : [] });
      return json(res, result.isError ? 400 : 200, result);
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/desk$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { path: ensureDesk(bot.id) });
    }

    if (method === "GET" && path === "/api/routines") {
      const botId = url.searchParams.get("botId") ?? undefined;
      return json(res, 200, { routines: listRoutines(botId || undefined) });
    }
    if (method === "POST" && path === "/api/routines") {
      const body = await readBody(req);
      const botId = String(body.botId ?? "");
      const prompt = String(body.prompt ?? "").trim();
      if (!store.bot(botId) || !prompt) return json(res, 400, { error: "botId and prompt required" });
      const kind = normalizeRoutineKind(body.kind);
      const watchPath = typeof body.watchPath === "string" ? body.watchPath : undefined;
      const dailyAt = typeof body.dailyAt === "string" ? body.dailyAt : undefined;
      const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret : undefined;
      const invalid = routineCreateError({ kind, watchPath, dailyAt, webhookSecret });
      if (invalid) return json(res, 400, { error: invalid });
      const routine = createRoutine({
        botId,
        name: String(body.name ?? prompt).slice(0, 80),
        prompt,
        kind,
        webhookSecret,
        githubRepo: typeof body.githubRepo === "string" ? body.githubRepo : undefined,
        watchPath,
        everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : undefined,
        dailyAt,
        weekdaysOnly: Boolean(body.weekdaysOnly),
        enabled: body.enabled !== false,
      });
      syncFileWatches();
      broadcast({ kind: "routines", routines: listRoutines() });
      const hookUrl = kind === "webhook" ? `http://127.0.0.1:${PORT}${routineHookPath(routine.id)}` : undefined;
      return json(res, 201, { routine, hookUrl });
    }
    if (method === "POST" && path === "/api/routines/from-thread") {
      const body = await readBody(req);
      const threadId = String(body.threadId ?? "");
      const bot = store.botByThread(threadId) || (body.botId ? store.bot(String(body.botId)) : null);
      if (!bot) return json(res, 400, { error: "bot or thread not found" });
      const msgs = store.messagesFor(bot.threadId);
      const lastUser = [...msgs].reverse().find((m) => m.role === "user" && m.kind === "text")?.text;
      const prompt = String(body.prompt ?? lastUser ?? "").trim();
      if (!prompt) return json(res, 400, { error: "prompt or user turn required" });
      const onComplete =
        body.onComplete && typeof body.onComplete === "object" && typeof (body.onComplete as any).targetBotId === "string"
          ? {
              targetBotId: String((body.onComplete as any).targetBotId),
              messageTemplate: typeof (body.onComplete as any).messageTemplate === "string" ? String((body.onComplete as any).messageTemplate) : undefined,
            }
          : undefined;
      const routine = createRoutineFromTurn({
        botId: bot.id,
        name: String(body.name ?? prompt.slice(0, 50)).trim(),
        prompt,
        dailyAt: typeof body.dailyAt === "string" ? body.dailyAt : "08:00",
        everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : undefined,
        weekdaysOnly: Boolean(body.weekdaysOnly),
        onComplete,
        maxTokens: body.maxTokens ? Number(body.maxTokens) : undefined,
      });
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 201, { routine });
    }
    if (method === "POST" && path === "/api/webhooks/github") {
      const body = await readBody(req);
      const provided = headerSecret(req);
      for (const r of listRoutines().filter((row) => row.enabled && row.kind === "webhook")) {
        if (!r.webhookSecret || !secretsMatch(r.webhookSecret, provided)) continue;
        if (r.githubRepo && !repoMatches(r.githubRepo, body)) continue;
        fireRoutineEvent(r, `Webhook event:\n${JSON.stringify(body, null, 2)}`);
      }
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/routines\/hooks\/([\w-]+)$/);
    if (m && method === "POST") {
      const routine = listRoutines().find((row) => row.id === m![1]);
      if (!routine) return json(res, 404, { error: "no such routine" });
      const body = await readBody(req);
      const provided = headerSecret(req);
      if (!routine.webhookSecret || !secretsMatch(routine.webhookSecret, provided)) {
        return json(res, 401, { error: "bad secret" });
      }
      if (routine.githubRepo && !repoMatches(routine.githubRepo, body)) {
        return json(res, 200, { skipped: "repo" });
      }
      fireRoutineEvent(routine, `Webhook event:\n${JSON.stringify(body, null, 2)}`);
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/routines\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const routineId = m[1];
      const existing = listRoutines().find((row) => row.id === routineId);
      if (!existing) return json(res, 404, { error: "no such routine" });
      const merged = { ...existing, ...body };
      const invalid = routineCreateError({
        kind: merged.kind,
        watchPath: merged.watchPath,
        dailyAt: merged.dailyAt,
        webhookSecret: merged.webhookSecret,
      });
      if (invalid) return json(res, 400, { error: invalid });
      const routine = patchRoutine(m[1], body);
      if (!routine) return json(res, 404, { error: "no such routine" });
      syncFileWatches();
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 200, { routine });
    }
    if (m && method === "DELETE") {
      if (!deleteRoutine(m[1])) return json(res, 404, { error: "no such routine" });
      syncFileWatches();
      broadcast({ kind: "routines", routines: listRoutines() });
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/skills") {
      return json(res, 200, { skills: listSkills() });
    }
    if (method === "POST" && path === "/api/skills") {
      const body = await readBody(req);
      try {
        const skill = saveSkill({
          name: String(body.name ?? ""),
          description: String(body.description ?? ""),
          fields: body.fields && typeof body.fields === "object" ? body.fields : undefined,
          slug: typeof body.slug === "string" ? body.slug : undefined,
        });
        if (body.routine && body.botId && store.bot(String(body.botId))) {
          createRoutine({
            botId: String(body.botId),
            name: skill.name,
            prompt: `Follow the skill "${skill.name}" at ${skill.path}.`,
            everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : 60,
            enabled: true,
          });
          broadcast({ kind: "routines", routines: listRoutines() });
        }
        return json(res, 201, { skill });
      } catch (e) {
        const status = (e as { status?: number }).status ?? 400;
        return json(res, status, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (method === "POST" && path === "/api/skills/from-turn") {
      const body = await readBody(req);
      const bot = store.bot(String(body.botId ?? ""));
      if (!bot) return json(res, 404, { error: "no such bot" });
      const msgs = store.messagesFor(bot.threadId);
      const userText = [...msgs].reverse().find((m) => m.role === "user" && m.kind === "text")?.text ?? "";
      const assistantText = [...msgs].reverse().find((m) => m.role === "bot" && m.kind === "text")?.text ?? "";
      const toolNames = msgs.filter((m) => m.kind === "activity" && m.tool?.name).map((m) => m.tool!.name);
      const draft = skillFromTurn({ name: typeof body.name === "string" ? body.name : undefined, userText, assistantText, toolNames });
      const skill = saveSkill(draft);
      if (body.routine) {
        createRoutine({
          botId: bot.id,
          name: skill.name,
          prompt: `Follow the skill "${skill.name}" at ${skill.path}.`,
          everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : 60,
          enabled: true,
        });
        broadcast({ kind: "routines", routines: listRoutines() });
      }
      return json(res, 201, { skill });
    }
    m = path.match(/^\/api\/skills\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (!deleteSkill(m[1])) return json(res, 404, { error: "no such skill" });
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/steer") {
      return json(res, 200, {
        token: steerToken,
        path: `/m.html#token=${steerToken}`,
        bind: BIND,
        port: PORT,
      });
    }
    if (method === "POST" && path === "/api/steer/rotate") {
      steerToken = rotateSteerToken();
      return json(res, 200, { token: steerToken, path: `/m.html#token=${steerToken}` });
    }
    if (method === "GET" && path === "/api/steer/bots") {
      const provided = tokenFromRequest(req.headers.authorization, url.searchParams.get("token"));
      if (!checkSteerToken(provided) && !authenticateRemoteToken(provided)) return json(res, 401, { error: "bad steer token" });
      return json(res, 200, {
        bots: store.bots
          .filter((b) => !b.hidden && b.kind !== "group")
          .map((b) => ({ id: b.id, name: b.name, busy: !!b.busy, color: b.color })),
      });
    }
    if (method === "GET" && path === "/api/harness") {
      return json(res, 200, {
        token: loadHarnessToken(),
        bind: BIND,
        offLoopback: bindIsOffLoopback(BIND),
        port: PORT,
      });
    }
    // ── NexBot Connect (host setup; device tokens authorize remote clients) ──
    if (path === "/api/remote-access" && method === "GET") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
      return json(res, 200, remoteAccessStatus(cfg, BIND, WEB_PORT));
    }
    if (path === "/api/remote-access" && (method === "PUT" || method === "PATCH")) {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
      const body = await readBody(req);
      const requestedMode = body.mode === "lan" || body.enabled === true ? "lan" : body.mode === "off" || body.enabled === false ? "off" : null;
      if (!requestedMode) return json(res, 400, { error: "mode must be lan or off" });
      saveConfig({ remoteAccess: { mode: requestedMode } });
      Object.assign(cfg, loadConfig());
      return json(res, 200, remoteAccessStatus(cfg, BIND, WEB_PORT));
    }
    if (path === "/api/remote-access/devices" && method === "POST") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
      const body = await readBody(req);
      const created = createRemoteDevice(body.label);
      const urls = pairingUrls(created.token, WEB_PORT);
      const mobileUrls = pairingMobileUrls(created.token, WEB_PORT);
      return json(res, 201, { device: created.device, token: created.token, pairingUrl: urls[0], pairingUrls: urls, mobileUrl: mobileUrls[0], mobileUrls });
    }
    if (path === "/api/remote-access/codes" && method === "POST") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "Pairing code setup is available on the host app only" });
      if (!bindIsOffLoopback(BIND)) return json(res, 409, { error: "Restart NexBot after enabling Private LAN mode before creating a code" });
      const body = await readBody(req);
      const requestedDeviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
      if (requestedDeviceId && !listRemoteDevices().some((device) => device.id === requestedDeviceId && device.active)) {
        return json(res, 404, { error: "no active device with that id" });
      }
      const created = createPairingCode(body.label, requestedDeviceId || undefined);
      const urls = pairingCodeUrls(created.code, WEB_PORT);
      return json(res, 201, { code: created.code, label: created.label, deviceId: created.deviceId, createdAt: created.createdAt, expiresAt: created.expiresAt, pairingUrl: urls[0], pairingUrls: urls });
    }
    if (path === "/api/remote-access/pair" && method === "POST") {
      if (!bindIsOffLoopback(BIND)) return json(res, 409, { error: "NexBot Connect is not listening on the LAN" });
      if (!allowPairingAttempt(req)) return json(res, 429, { error: "Too many pairing attempts. Wait one minute." });
      const body = await readBody(req);
      const pairing = consumePairingCode(body.code);
      if (!pairing) return json(res, 401, { error: "The pairing code is invalid or expired" });
      const created = pairing.deviceId ? rotateRemoteDevice(pairing.deviceId) : createRemoteDevice(body.label || pairing.label);
      if (!created) return json(res, 404, { error: "the device is no longer available" });
      return json(res, 201, { device: created.device, token: created.token });
    }
    m = path.match(/^\/api\/remote-access\/devices\/([\w-]+)\/rotate$/);
    if (m && method === "POST") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
      const rotated = rotateRemoteDevice(m[1]);
      if (!rotated) return json(res, 404, { error: "no active device with that id" });
      const urls = pairingUrls(rotated.token, WEB_PORT);
      const mobileUrls = pairingMobileUrls(rotated.token, WEB_PORT);
      return json(res, 200, { device: rotated.device, token: rotated.token, pairingUrl: urls[0], pairingUrls: urls, mobileUrl: mobileUrls[0], mobileUrls });
    }
    m = path.match(/^\/api\/remote-access\/devices\/([\w-]+)(?:\/revoke)?$/);
    if (m && (method === "DELETE" || (method === "POST" && path.endsWith("/revoke")))) {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "Connect setup is available on the host app only" });
      const revoked = revokeRemoteDevice(m[1]);
      if (!revoked) return json(res, 404, { error: "no device with that id" });
      try {
        revokeWireGuardPeer(m[1]);
      } catch {
        // The access token is revoked even when an optional host VPN is offline.
      }
      return json(res, 200, { device: revoked });
    }
    if (path === "/api/remote-access/device" && method === "GET") {
      if (!remoteDevice) return json(res, 401, { error: "a NexBot Connect device token is required" });
      return json(res, 200, { device: remoteDevice });
    }
    if (path === "/api/remote-access/wireguard" && method === "GET") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "WireGuard setup is available on the host app only" });
      return json(res, 200, wireGuardStatus());
    }
    if (path === "/api/remote-access/wireguard" && (method === "POST" || method === "PUT")) {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "WireGuard setup is available on the host app only" });
      const body = await readBody(req);
      const endpoint = String(body.endpoint ?? "").trim();
      const listenPort = body.listenPort === undefined ? undefined : Number(body.listenPort);
      if (!isWireGuardEndpoint(endpoint)) return json(res, 400, { error: "endpoint must be a host and UDP port, for example vpn.example.com:51820" });
      try {
        return json(res, 200, setupWireGuard({ endpoint, listenPort }));
      } catch (error) {
        return json(res, 503, { error: error instanceof Error ? error.message : String(error), code: "WIREGUARD_UNAVAILABLE" });
      }
    }
    m = path.match(/^\/api\/remote-access\/devices\/([\w-]+)\/wireguard$/);
    if (m && method === "POST") {
      if (!requestIsLoopback(req) && remoteDevice?.id !== m[1]) return json(res, 403, { error: "A device can provision only its own VPN peer" });
      const body = await readBody(req);
      const publicKey = String(body.publicKey ?? "").trim();
      if (!isWireGuardPublicKey(publicKey)) return json(res, 400, { error: "publicKey must be a WireGuard public key" });
      try {
        return json(res, 200, { vpn: provisionWireGuardPeer(m[1], publicKey) });
      } catch (error) {
        return json(res, 503, { error: error instanceof Error ? error.message : String(error), code: "WIREGUARD_UNAVAILABLE" });
      }
    }
    if (method === "POST" && path === "/api/harness/rotate") {
      return json(res, 200, { token: rotateHarnessToken() });
    }
    if (method === "POST" && path === "/api/steer/jobs") {
      const provided = tokenFromRequest(req.headers.authorization, url.searchParams.get("token"));
      if (!checkSteerToken(provided) && !authenticateRemoteToken(provided)) return json(res, 401, { error: "bad steer token" });
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      const botIds = Array.isArray(body.botIds) ? body.botIds.map(String) : [];
      if (!text || !botIds.length) return json(res, 400, { error: "text and botIds required" });
      const started: string[] = [];
      for (const id of botIds) {
        const b = store.bot(id);
        if (!b || b.busy || b.hidden || b.kind === "group") continue;
        await startTurn(id, `[Steer]\n\n${text}`).catch(() => {});
        started.push(id);
      }
      return json(res, 202, { started });
    }

    if (method === "GET" && path === "/api/capabilities") {
      return json(
        res,
        200,
        detectCapabilities({
          cuaReady: Boolean(readCuaConnection()),
          electron: Boolean(process.env.NEXBOT_CUA_CONNECTION || process.versions.electron),
          packaged: Boolean(process.env.NEXBOT_STATIC_DIR),
        }),
      );
    }

    m = path.match(/^\/api\/jobs\/([\w-]+)\/(resume|retry)$/);
    if (m && method === "POST") {
      const job = getJob(m[1]);
      if (!job) return json(res, 404, { error: "no such job" });
      const bot = store.bot(job.botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (bot.busy || bot.operatorControl) return json(res, 409, { error: "the bot is busy or under operator control" });
      const promptText = prepareReflexionPrompt(job, store);
      await startTurn(job.botId, promptText, {
        jobId: job.id,
        resume: m[2] === "resume",
        replay: true,
        source: job.source,
        taskContext: job.taskContext,
      });
      return json(res, 202, { ok: true, job: getJob(job.id) });
    }
    if (method === "POST" && path === "/api/jobs") {
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      const botIds = Array.isArray(body.botIds) ? body.botIds.map(String) : [];
      if (!text || !botIds.length) return json(res, 400, { error: "text and botIds required" });
      const started: string[] = [];
      for (const id of botIds) {
        const b = store.bot(id);
        if (!b || b.busy || b.hidden) continue;
        if (isForbiddenFightAsk(null, b, text)) continue;
        appendHandoff({ from: null, to: { id: b.id, name: b.name, color: b.color }, text });
        // User-initiated task. Any active bot can delegate within its bounded scope.
        await startTurn(id, `[Team job]\n\n${text}`).catch(() => {});
        started.push(id);
      }
      return json(res, 202, { started });
    }
    if (method === "GET" && path === "/api/jobs") {
      const all = url.searchParams.get("all") === "1";
      return json(res, 200, {
        jobs: listJobs(all ? undefined : { statuses: ["running", "interrupted"] }).map((job) => ({
          ...job,
          botName: store.bot(job.botId)?.name ?? "Unknown bot",
        })),
      });
    }

    // identity handshake for the packaged app's port fallback: the forked
    // child proves it is OURS by echoing its pid (a stray dev server has
    // the same API shape but a different pid)
    if (method === "GET" && path === "/api/health") {
      return json(res, 200, { app: "nexbot", pid: process.pid, static: Boolean(STATIC_DIR) });
    }
    if (method === "GET" && path === "/api/execution-receipts") {
      const botId = url.searchParams.get("botId") ?? undefined;
      const jobId = url.searchParams.get("jobId") ?? undefined;
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
      return json(res, 200, { receipts: listReceipts({ botId, jobId, limit }) });
    }
    if (method === "GET" && path === "/api/doctor") {
      const runningJobs = listJobs({ statuses: ["running"] });
      const queueCount = store.bots.reduce((count, bot) => count + queuedTurns(bot.id).length, 0);
      const checks = localDoctorChecks({ cuaReady: Boolean(readCuaConnection()), queuedTurns: queueCount, runningJobs: runningJobs.length });
      for (const instance of await registry.describe()) {
        checks.push({
          id: `provider:${instance.instanceId}`,
          status: instance.snapshot.state === "available" ? "pass" : "warn",
          detail: instance.snapshot.state === "available"
            ? `${instance.displayName ?? instance.instanceId} is available.`
            : `${instance.displayName ?? instance.instanceId}: ${instance.snapshot.reason ?? "unavailable"}`,
        });
      }
      return json(res, 200, { overall: doctorOverall(checks), checks, at: Date.now() });
    }
    if (method === "GET" && path === "/api/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json(res, 400, { error: "q required" });
      const messages = searchMessages(q).map((hit) => {
        const bot = hit.botId ? store.bot(hit.botId) : store.botByThread(hit.threadId);
        return { ...hit, botId: bot?.id ?? hit.botId, botName: bot?.name };
      });
      const facts = searchMemoryFacts(q).map((fact) => ({
        messageId: `memory:${fact.id}`,
        threadId: store.bot(fact.botId)?.threadId ?? fact.botId,
        botId: fact.botId,
        botName: store.bot(fact.botId)?.name,
        text: fact.fact,
        at: fact.sourceAt,
        provenance: { sourceType: fact.sourceType, sourceId: fact.sourceId, confidence: fact.confidence },
      }));
      return json(res, 200, { results: [...facts, ...messages].sort((a, b) => b.at - a.at).slice(0, 100), retrieval: "structured-memory + transcript-fts" });
    }

    if (method === "GET" && path === "/api/feed") {
      const items: Array<{
        id: string;
        kind: "failed_routine" | "stuck_turn" | "pending_todo" | "unread_mention";
        botId: string;
        botName: string;
        title: string;
        detail: string;
        at: number;
        severity: "high" | "medium" | "low";
      }> = [];

      const stuckList = watchdog.stuckBots();
      for (const s of stuckList) {
        const bot = store.bot(s.botId);
        if (bot) {
          items.push({
            id: `stuck-${bot.id}-${s.startedAt}`,
            kind: "stuck_turn",
            botId: bot.id,
            botName: bot.name,
            title: `Turn stuck on @${bot.name}`,
            detail: `Active for ${Math.round((Date.now() - s.startedAt) / 1000)}s without events`,
            at: s.startedAt,
            severity: "high",
          });
        }
      }

      const stalledList = watchdog.stalledBots();
      for (const s of stalledList) {
        const bot = store.bot(s.botId);
        if (bot && !stuckList.some((st) => st.botId === bot.id)) {
          items.push({
            id: `stalled-${bot.id}-${s.startedAt}`,
            kind: "stuck_turn",
            botId: bot.id,
            botName: bot.name,
            title: `Stream stalled on @${bot.name}`,
            detail: `No tokens received for ${Math.round((Date.now() - (s.lastChunkAt || s.startedAt)) / 1000)}s`,
            at: s.lastChunkAt || s.startedAt,
            severity: "medium",
          });
        }
      }

      for (const bot of store.bots.filter((b) => !b.hidden)) {
        const todos = listTodos(bot.id);
        for (const td of todos) {
          if (td.status === "in_progress" || td.status === "pending") {
            items.push({
              id: `todo-${bot.id}-${td.id}`,
              kind: "pending_todo",
              botId: bot.id,
              botName: bot.name,
              title: td.status === "in_progress" ? `In-progress: ${td.content}` : `Pending: ${td.content}`,
              detail: `@${bot.name} todo item`,
              at: Date.now(),
              severity: td.status === "in_progress" ? "medium" : "low",
            });
          }
        }
      }

      for (const bot of store.bots.filter((b) => !b.hidden && b.unread)) {
        const messages = store.messagesFor(bot.threadId);
        const lastMsg = messages[messages.length - 1];
        items.push({
          id: `unread-${bot.id}`,
          kind: "unread_mention",
          botId: bot.id,
          botName: bot.name,
          title: `Unread message on @${bot.name}`,
          detail: lastMsg?.text ? lastMsg.text.slice(0, 80) : "New message",
          at: lastMsg?.at || Date.now(),
          severity: "medium",
        });
      }

      const failedRoutinesCount = items.filter((i) => i.kind === "failed_routine").length;
      const stuckTurnsCount = items.filter((i) => i.kind === "stuck_turn").length;
      const pendingTodosCount = items.filter((i) => i.kind === "pending_todo").length;
      const unreadCount = items.filter((i) => i.kind === "unread_mention").length;

      return json(res, 200, {
        summary: {
          total: items.length,
          failedRoutinesCount,
          stuckTurnsCount,
          pendingTodosCount,
          unreadCount,
        },
        items,
      });
    }

    // ── provider instances (model picker) ──
    if (method === "GET" && path === "/api/instances") {
      return json(res, 200, { instances: await registry.describe() });
    }
    if (method === "POST" && path === "/api/instances") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "provider setup is available on the host app only" });
      const body = await readBody(req);
      const instanceId = String(body.instanceId ?? "").trim();
      const cli = String(body.cli ?? "").trim();
      const args = Array.isArray(body.args) ? body.args.map(String) : String(body.args ?? "").split(/\s+/).filter(Boolean);
      const model = String(body.model ?? "default").trim() || "default";
      if (!/^[a-z][a-z0-9_-]{1,39}$/i.test(instanceId)) return json(res, 400, { error: "instanceId must use letters, numbers, dashes, or underscores" });
      if (!cli) return json(res, 400, { error: "CLI command required" });
      const instances = {
        ...(cfg.instances ?? defaultInstanceConfigs()),
        [instanceId]: {
          driver: "acp",
          displayName: String(body.displayName ?? instanceId).trim().slice(0, 80),
          config: {
            cli,
            args: args.slice(0, 40),
            model,
            workspace: typeof body.workspace === "string" ? body.workspace.trim() : undefined,
            authMethod: typeof body.authMethod === "string" ? body.authMethod.trim() : undefined,
            fullAuto: false,
          },
        },
      };
      saveConfig({ instances });
      Object.assign(cfg, loadConfig());
      await reloadProviders();
      return json(res, 201, { instances: await registry.describe() });
    }
    m = path.match(/^\/api\/instances\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "provider setup is available on the host app only" });
      if (!cfg.instances?.[m[1]] || cfg.instances[m[1]].driver !== "acp") return json(res, 404, { error: "no custom ACP instance" });
      const instances = { ...cfg.instances };
      delete instances[m[1]];
      saveConfig({ instances });
      Object.assign(cfg, loadConfig());
      await reloadProviders();
      return json(res, 200, { instances: await registry.describe() });
    }

    // ── app config (API keys — never echoed back, booleans only) ──
    if (method === "GET" && path === "/api/config") {
      return json(res, 200, configStatus(cfg, BIND));
    }
    if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
      const body = await readBody(req);
      const patch: Record<string, object> = {};
      for (const key of ["xai", "composio", "box", "profile", "remoteAccess"] as const) {
        if (body[key] && typeof body[key] === "object") patch[key] = body[key];
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
      saveConfig(patch);
      Object.assign(cfg, loadConfig());
      // provider keys change the fleet; a profile edit must not kill
      // in-flight turns with a pointless reload
      if (Object.keys(patch).some((k) => k !== "profile")) await reloadProviders();
      const status = configStatus(cfg, BIND);
      broadcast({ kind: "config", ...status });
      return json(res, 200, status);
    }

    // ── encrypted credential vault (host app only) ──
    if (path === "/api/credentials" && method === "GET") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
      return json(res, 200, { credentials: listCredentials() });
    }
    if (path === "/api/credentials" && method === "POST") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
      const body = await readBody(req);
      const botIds = Array.isArray(body.botIds) ? body.botIds.map(String).filter((id) => store.bot(id)) : [];
      try {
        const credential = createCredential({
          label: String(body.label ?? ""),
          envName: String(body.envName ?? ""),
          secret: String(body.secret ?? ""),
          botIds,
        });
        return json(res, 201, { credential });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    m = path.match(/^\/api\/credentials\/([\w-]+)$/);
    if (m && method === "PATCH") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
      const body = await readBody(req);
      const botIds = Array.isArray(body.botIds) ? body.botIds.map(String).filter((id) => store.bot(id)) : [];
      const credential = setCredentialGrants(m[1], botIds);
      return credential ? json(res, 200, { credential }) : json(res, 404, { error: "no such credential" });
    }
    if (m && method === "DELETE") {
      if (!requestIsLoopback(req)) return json(res, 403, { error: "credential management is available on the host app only" });
      return deleteCredential(m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "no such credential" });
    }

    // ── connectors (Composio) ──
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source } = await composio.listToolkits(cfg);
      return json(res, 200, { configured: Boolean(cfg.composio?.key), source, cards });
    }
    if (method === "GET" && path === "/api/connectors") {
      const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
      if (!cfg.composio?.key) return json(res, 200, { configured: false, services: {} });
      const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
      return json(res, 200, { configured: true, services: status });
    }
    m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
    if (m && method === "POST") return json(res, 200, await composio.authorizeService(cfg, m[1]));
    m = path.match(/^\/api\/connectors\/([\w-]+)$/);
    if (m && method === "DELETE") return json(res, 200, await composio.removeService(cfg, m[1]));

    // ── the bot's cloud computer (Box) ──
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
    if (m && method === "GET") return json(res, 200, await box.boxStatus(cfg, m[1]));
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
    if (m && method === "POST") {
      const botId = m[1];
      const bot = store.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      switch (m[2]) {
        case "provision":
          return json(res, 200, await box.provisionBox(cfg, botId, bot.name));
        case "join":
          return json(res, 200, await box.joinBox(cfg, botId));
        case "sleep":
          return json(res, 200, await box.sleepBox(cfg, botId));
        case "exec": {
          const body = await readBody(req);
          const command = String(body.command ?? "");
          const hook = preToolHook({ name: "computer_exec", command });
          if (!hook.allow) {
            return json(res, 400, { error: hook.reason ?? "blocked a request to read process environment secrets" });
          }
          return json(res, 200, await box.execOnBox(cfg, botId, command));
        }
        case "screenshot":
          return json(res, 200, await box.screenshotBox(cfg, botId));
      }
    }

    // packaged app: the server serves the built UI too (window → :8799 for
    // everything, no dev proxy to die). NEXBOT_STATIC_DIR is set by Electron.
    if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
      if (serveStatic(res, STATIC_DIR, path)) return;
    }

    return json(res, 404, { error: `no route: ${method} ${path}` });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    return json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
});

function groupMemberError(ids: string[]): string | null {
  if (ids.length < 2 || ids.length > 6) return "a group needs 2 to 6 teammates";
  for (const id of ids) {
    const member = store.bot(id);
    if (!member || member.kind === "group" || member.hidden) {
      return "members must be existing visible non-group bots";
    }
  }
  return null;
}

function headerSecret(req: IncomingMessage): string {
  const h = req.headers["x-nexbot-secret"];
  return Array.isArray(h) ? (h[0] ?? "") : (h ?? "");
}

function wipeHeader(req: IncomingMessage): string {
  const h = req.headers["x-nexbot-wipe-password"];
  return Array.isArray(h) ? (h[0] ?? "") : (h ?? "");
}

function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function repoMatches(filter: string, body: { repository?: { full_name?: string } }): boolean {
  const name = String(body?.repository?.full_name ?? "");
  return name.toLowerCase() === filter.toLowerCase();
}

function fireRoutineEvent(r: { id: string; botId: string; name: string; prompt: string }, extra: string): boolean {
  const bot = store.bot(r.botId);
  if (!bot || bot.busy || bot.operatorControl) return false;
  const text = `[Routine: ${r.name}]\n\n${r.prompt}\n\n${extra}`;
  markRan(r.id);
  rememberTurn(r.botId, text, "routine");
  void startTurn(r.botId, text, { source: "routine" }).catch(() => {});
  broadcast({ kind: "routines", routines: listRoutines() });
  return true;
}

const fileWatchers = new Map<string, { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }>();

function closeFileWatch(id: string) {
  const row = fileWatchers.get(id);
  if (!row) return;
  if (row.timer) clearTimeout(row.timer);
  try {
    row.watcher.close();
  } catch {}
  fileWatchers.delete(id);
}

function syncFileWatches() {
  for (const id of [...fileWatchers.keys()]) closeFileWatch(id);
  for (const r of listRoutines()) {
    if (!r.enabled || r.kind !== "file" || !r.watchPath) continue;
    const watchPath = r.watchPath;
    if (!existsSync(watchPath)) continue;
    const routineId = r.id;
    try {
      const watcher = watch(watchPath, (_event, filename) => {
        const entry = fileWatchers.get(routineId);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          const current = listRoutines().find((x) => x.id === routineId);
          if (!current?.enabled || current.kind !== "file") return;
          const bot = store.bot(current.botId);
          if (!bot || bot.busy || bot.operatorControl) return;
          const changed = filename ? String(filename) : watchPath;
          fireRoutineEvent(current, `File changed: ${changed}`);
        }, 400);
      });
      fileWatchers.set(routineId, { watcher });
    } catch {
      /* path missing or unwatchable */
    }
  }
}

function runDueRoutines() {
  for (const r of dueRoutines()) {
    const bot = store.bot(r.botId);
    if (!bot || bot.busy || bot.operatorControl) continue;
    markRan(r.id);
    rememberTurn(r.botId, `[Routine: ${r.name}]\n\n${r.prompt}`, "routine");
    void startTurn(r.botId, `[Routine: ${r.name}]\n\n${r.prompt}`, {
      source: "routine",
      onComplete: r.onComplete,
      maxTokens: r.maxTokens,
    }).catch(() => {});
    broadcast({ kind: "routines", routines: listRoutines() });
  }
}

function recoverAfterBoot() {
  runDueRoutines();
}

const BIND = process.env.NEXBOT_BIND?.trim() || remoteAccessStatus(cfg).configuredBind;
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(portBusyHint(PORT));
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
server.listen(PORT, BIND, () => {
  console.log(`nexbot server on http://${BIND}:${PORT}`);
  if (bindIsOffLoopback(BIND)) {
    loadHarnessToken();
    console.log(`nexbot: bound off-loopback. Non-local /api calls need a token from ${join(DATA_DIR, "harness.json")}.`);
  }
  syncFileWatches();
  setTimeout(recoverAfterBoot, 2500);
  setTimeout(() => {
    for (const bot of store.bots) {
      if (queuedTurns(bot.id).length > 0) drainUserQueue(bot.id);
    }
  }, 2600);
  setTimeout(() => {
    for (const botId of agentInbox.keys()) drainAgentInbox(botId);
  }, 2700);
});

setInterval(runDueRoutines, 30_000);
setInterval(() => {
  for (const row of watchdog.stalledBots()) {
    const bot = store.bot(row.botId);
    if (!bot?.busy) continue;
    broadcast({
      kind: "warning",
      botId: bot.id,
      name: bot.name,
      body: `${bot.name} has not produced a token in 45s.`,
    });
  }
  for (const row of watchdog.stuckBots()) {
    const bot = store.bot(row.botId);
    if (!bot?.busy) {
      watchdog.end(row.botId);
      continue;
    }
    broadcast({
      kind: "stuck",
      botId: bot.id,
      name: bot.name,
      body: `${bot.name} has made no progress. Work on this PC may be stuck.`,
    });
    const stuckTurn = turnMeta.get(bot.id);
    if (stuckTurn?.jobId) {
      updateJob(stuckTurn.jobId, { status: "interrupted", error: "turn stopped after the watchdog timeout" });
    }
    store.patchBot(bot.id, { busy: false });
    forgetTurn(bot.id);
    turnGroup.delete(bot.id);
    turnMeta.delete(bot.id);
    void registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId).catch(() => {});
    broadcast({ kind: "bot", bot: store.bot(bot.id) });
    watchdog.end(bot.id);
    setTimeout(() => drainAgentInbox(bot.id), 50);
  }
}, 10_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry.disposeAll().finally(() => process.exit(0));
  });
}
