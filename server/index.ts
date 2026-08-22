// NexBot server — the harness host. Clients hold no transports
// (a harness invariant): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { randomBytes } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as box from "./box.ts";
import { ensureDirs, instanceConfigs, loadConfig, DATA_DIR, wipePassword } from "./config.ts";
import type { ModelSelection, ReasoningEffort, RuntimeEvent } from "./contracts.ts";
import { readCuaConnection } from "./cua-connection.ts";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { EventBus } from "./harness/bus.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { buildPersona, deskPrompt, ensureDesk, ensureMemory, memoryPrompt } from "./desk.ts";
import { json, readBody, serveStatic, portBusyHint, wipeHeader, secretsMatch } from "./http-util.ts";
import { completeReceipt, interruptReceipts, listReceipts, startReceipt, type ExecutionReceipt } from "./execution-evidence.ts";
import { assessClaimEvidence, shortCaveat } from "./claim-evidence.ts";
import { claimFeedbackPrompt, setClaimFeedback, takeClaimFeedback } from "./claim-feedback.ts";
import { armVerify, takeVerify, verifyPrompt } from "./verify-request.ts";
import { recordHandoffPromise, takeNextHandoffPromiseForTarget } from "./handoff-promise.ts";
import { classifyPermission } from "./risk-policy.ts";
import { queuedTurns, takeNextTurn } from "./turn-queue.ts";
import { memoryFactsPrompt } from "./memory-facts.ts";
import { forgetTurn, rememberTurn } from "./pending.ts";
import { prepareReflexionPrompt, sessionDeathSettlement } from "./recovery.ts";
import { createJob, getJob, updateJob } from "./jobs.ts";
import {
  dueRoutines,
  listRoutines,
  markRan,
  publicRoutines,
} from "./routines.ts";
import { ASK_BOT_STILL_WORKING, ASK_BOT_WAIT_MS, boundToolOutput } from "./comms-policy.ts";
import { createScreenPoller } from "./screen-poller.ts";
import { clipForTurn, handoffThreadIds, mentionedBots, Store, type Message, type TurnEffort } from "./store.ts";
import { isChiefOfStaffRole, SLEEP_WARNING, withRolePrompt, isForbiddenFightAsk } from "./roles.ts";
import { onTodosChange } from "./todo.ts";
import { autoDistillFromTurn, skillsPrompt } from "./skills.ts";
import { onToolError, postToolHook, preToolHook } from "./tool-hooks.ts";
import { credentialsForBot } from "./credentials.ts";
import { checkSteerToken } from "./steer.ts";
import {
  authorizeHarnessRequest,
  bindIsOffLoopback,
  isPublicHarnessPath,
  loadHarnessToken,
  requestLooksCrossSite,
  tokenFromHarnessRequest,
} from "./harness-auth.ts";
import {
  authenticateRemoteToken,
  remoteAccessEnabled,
  remoteAccessStatus,
} from "./remote-access.ts";
import { stripWorkingNarration } from "../src/lib/activity.ts";
import { createNonceCache } from "./nonce.ts";
import { createWatchdog, DEFAULT_MAX_TOKENS_PER_TURN, isComputerToolName } from "./watchdog.ts";
import { chooseAntigravityCosSelection, pickDefaultSelection } from "./selection.ts";
import { isMeaningfulUpdate, proactivePrompt, shouldTriggerProactive, type ProactiveReason } from "./proactivity.ts";
import { routingDirective, suggestSpecialistRoutes } from "./routing.ts";
import { semanticRoute, type SemanticRouteDecision } from "./semantic-router.ts";
import { loadAgentInbox, persistAgentInbox, type StoredAgentMessage } from "./agent-inbox.ts";
import { createTaskContext, delegateTask, isTaskDelegation, type TaskContext } from "./task-context.ts";
import { wipeLocalData } from "./wipe.ts";
import { renderArtifactsForReply, serveArtifact } from "./artifacts.ts";
import { userFacingError } from "./user-errors.ts";
import { runDataHygiene } from "./data-hygiene.ts";
import { pruneEventLogs } from "./event-log.ts";
import { enqueueConversationArchive, ensureConversationArchive, freshSessionContextPrompt } from "./conversation-context.ts";
import { handleInternalRoutes } from "./web/internal-routes.ts";
import { handleBotRoutes } from "./web/bot-routes.ts";
import { handleRoutineRoutes } from "./web/routine-routes.ts";
import { handleAccessRoutes } from "./web/access-routes.ts";
import { handlePlatformRoutes } from "./web/platform-routes.ts";
import { harness } from "./web/context.ts";

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
  /** Verification-only pass — the bot re-checks a claim it overstated, and the harness suppresses the CoS completion report. */
  verify?: boolean;
};

const nonceCache = createNonceCache(60_000);
// A relay wait owns the user-facing result when the target finishes within
// the wait window. If the wait times out, the target's completion report must
// still reach Chief of Staff after the target eventually finishes.
const relayResolvedThreads = new Set<string>();

// The peer's honest verification state, e.g. "unverified: 1 action failed".
// Callers frame it (delegation relay vs completion-report line).
function claimCaveatForBot(botId: string): string {
  const bot = store.bot(botId);
  if (!bot) return "";
  const last = [...store.messagesFor(bot.threadId)].reverse().find((m) => m.role === "bot" && m.kind === "text");
  if (!last?.claimEvidence) return "";
  const label = last.claimEvidence.verdict === "unverified" ? "unverified" : "not fully verified";
  return `${label}: ${shortCaveat(last.claimEvidence.note)}`;
}

// Resolve a queued handoff promise: when the target completes a turn, ping the
// delegator in ITS thread with the result, so the promised "I'll ping you back"
// actually lands instead of relying on a generic completion report. Returns the
// delegator id pinged (or null) so the caller can suppress a duplicate report.
function resolveHandoffPromise(targetBotId: string, resultText: string): string | null {
  const promise = takeNextHandoffPromiseForTarget(targetBotId);
  if (!promise) return null;
  const delegator = store.bot(promise.fromBotId);
  if (!delegator || delegator.kind === "group") return null;
  const target = store.bot(targetBotId);
  const targetName = target?.name ?? "that bot";
  const caveat = claimCaveatForBot(targetBotId);
  const result = resultText.trim().slice(0, 2000) || "(the bot finished without a text reply)";
  const caveatLine = caveat ? `\n\nHonesty caveat: ${caveat}` : "";
  const prompt = `[Handoff resolved]

You handed this to @${targetName} and told Charles you would report back. The work is done. Reply to Charles in this thread as that promised ping-back. Lead with the concrete result, mention the honesty caveat if present, and do not restate the handoff mechanics. Keep it short. Do not delegate back.

Original request: ${promise.request.slice(0, 500)}
Result from @${targetName}: ${result}${caveatLine}`;
  void startTurn(delegator.id, prompt, { source: "completion" }).catch(() => {});
  return delegator.id;
}

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
        const reply = boundToolOutput(text) || "(the bot finished without a text reply)";
        const caveat = claimCaveatForBot(target.id);
        finish(caveat ? `[Result from @${target.name} — ⚠ ${caveat}]\n\n${reply}` : reply);
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
/** botId → group thread that started this turn (shared transcript). */
const turnGroup = new Map<string, string>();
type TurnKind = "user" | "agent" | "routine" | "proactive" | "completion";
// Synchronous claim taken the moment a turn is requested. bot.busy only
// flips after provider probing (which can await a CLI --version call for
// seconds), so without this a second send can slip through the gate while
// the first is still dispatching.
const turnReservations = new Set<string>();
const turnMeta = new Map<string, {
  kind: TurnKind;
  messageStart: number;
  startedAt: number;
  sourceBotId?: string;
  jobId?: string;
  relayResult?: boolean;
  verify?: boolean;
  reasoningText?: string;
  reasoningTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}>();
type QueuedAgentMessage = StoredAgentMessage;
const agentInbox = loadAgentInbox();
type CompletionReport = { botId: string; name: string; text: string; at: number; caveat?: string };
const completionReports: CompletionReport[] = [];
let cosReportTimer: ReturnType<typeof setTimeout> | undefined;
const proactivePending = new Map<string, Set<ProactiveReason>>();
const taskMessageCounts = new Map<string, number>();
const usagePersistAt = new Map<string, number>();

// ── SSE fan-out to clients ─────────────────────────────────────────────
const sseClients = new Set<ServerResponse>();
// Clients whose socket buffer is full (write() returned false). While a
// client is congested we drop bulky screen frames instead of queueing
// unbounded memory; the drain event restores normal delivery.
const congestedSseClients = new WeakSet<ServerResponse>();

function broadcast(payload: unknown) {
  const kind = (payload as { kind?: string } | null)?.kind;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    if (congestedSseClients.has(res) && kind === "screen") continue;
    try {
      const ok = res.write(frame);
      if (!ok) {
        congestedSseClients.add(res);
        res.once("drain", () => congestedSseClients.delete(res));
      }
    } catch {
      congestedSseClients.delete(res);
      sseClients.delete(res);
    }
  }
}
onTodosChange((botId, items) => {
  broadcast({ kind: "todos", botId, items });
  // Deliberately no proactive wake here: todo churn is machinery, and the
  // CoS hears about finished work through completion reports instead.
});

// ── live screen poller ─────────────────────────────────────────────────
const screens = createScreenPoller({
  isConfigured: () => box.boxConfigured(cfg),
  screenshot: (botId) => box.screenshotBox(cfg, botId),
  onFrame: (botId, frame) => broadcast({ kind: "screen", botId, ...frame }),
});

// ── server-side event folding (the ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
const toolMessageByItem = new Map<string, string>(); // itemId -> messageId
const receiptByItem = new Map<string, string>(); // itemId -> receiptId
const receiptMessage = new Map<string, { threadId: string; messageId: string }>();
const askMessageByRequest = new Map<string, string>(); // requestId -> messageId
const turnTools = new Map<string, { names: string[]; okNames: string[] }>();
// Latch so a budget-exceeded turn is interrupted once, not on every usage event.
const budgetStopped = new Set<string>();
// member message id -> the copy placed in a shared group thread, so an honesty
// caveat computed at turn end can be propagated to the group copy too.
const groupCopyByMember = new Map<string, string>();

function patchReceiptMessage(receipt: ExecutionReceipt): void {
  const link = receiptMessage.get(receipt.id);
  if (!link) return;
  const existing = store.getMessage(link.threadId, link.messageId);
  if (receipt.status !== "running") receiptMessage.delete(receipt.id);
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
    // One usage tick per assistant message: keep memory live, but write the
    // row at most every 2s per bot. The turn-end busy:false persist carries
    // the final value, so a crash loses at most 2s of usage stats.
    const now = Date.now();
    const persistUsage = now - (usagePersistAt.get(bot.id) ?? 0) >= 2_000;
    if (persistUsage) usagePersistAt.set(bot.id, now);
    store.patchBot(bot.id, { usage: extra.tokens }, { persist: persistUsage });
    broadcast({ kind: "usage", botId: bot.id, usage: extra.tokens });
    const currentTurn = turnMeta.get(bot.id);
    if (currentTurn) {
      currentTurn.inputTokens = event.input ?? 0;
      currentTurn.outputTokens = event.output ?? 0;
      const currentJob = currentTurn.jobId ? getJob(currentTurn.jobId) : null;
      const ceiling = currentJob?.maxTokens ?? DEFAULT_MAX_TOKENS_PER_TURN;
      if (watchdog.isBudgetExceeded(bot.id, ceiling)) {
        console.warn(`[watchdog] Token budget ceiling exceeded for bot ${bot.name} (${bot.id})`);
        // Enforce the ceiling — interrupt a runaway turn instead of only logging
        // it. The job is marked interrupted with the reason, so the user sees
        // why the turn stopped rather than a silent empty reply.
        if (!budgetStopped.has(bot.id)) {
          budgetStopped.add(bot.id);
          void stopActiveTurn(bot.id, `token budget ceiling exceeded (${ceiling})`);
        }
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
          const memberMsg = pushMessage({
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
              // Remember the member→group-copy link so a turn-end honesty
              // caveat can be propagated to the shared thread too.
              groupCopyByMember.set(memberMsg.id, copied.id);
              broadcast({ kind: "message", threadId: group.threadId, message: copied });
            }
          }
        }
      } else if (event.itemType === "tool" && event.itemId) {
        const messageId = toolMessageByItem.get(event.itemId);
        const existingName = (messageId ? store.getMessage(event.threadId, messageId) : null)?.tool?.name ?? "tool";
        if (event.ok === false) onToolError({ name: existingName, title: existingName });
        else postToolHook({ name: existingName, title: existingName });
        const tools = turnTools.get(bot.id);
        if (tools && event.ok !== false) tools.okNames.push(existingName);
        const receiptId = receiptByItem.get(event.itemId);
        const receipt = receiptId ? completeReceipt(receiptId, event.ok !== false) : null;
        if (receipt) patchReceiptMessage(receipt);
        if (messageId) {
          const existingTool = store.getMessage(event.threadId, messageId)?.tool;
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
        const existing = event.threadId ? store.getMessage(event.threadId, messageId) : null;
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
      // Raw internals live in the events/ log for the operator; the chat
      // transcript only ever sees calm, human text.
      console.error(`[harness] runtime error on ${event.threadId}:`, event.message);
      pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${userFacingError(event.message)}`, ok: false } });
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
          // Hold the reply's claim up against the receipts this turn actually
          // produced. If the evidence contradicts or cannot confirm the claim,
          // attach an honest caveat so an agent's "done" is never presented as
          // verified when it isn't.
          const claimEvidence = currentTurn.jobId
            ? assessClaimEvidence(listReceipts({ jobId: currentTurn.jobId }))
            : null;
          if (claimEvidence) {
            patch.claimEvidence = claimEvidence;
            // When the evidence contradicted the claim, remind the bot to verify
            // on its next turn so it stops asserting unverified outcomes.
            if (claimEvidence.verdict === "unverified") {
              setClaimFeedback(bot.id, claimEvidence.note);
              // One-shot verify pass: the bot re-checks the state it overstated.
              // Only for a user-initiated turn, never for a verify turn itself,
              // and never while the operator owns the computer.
              if (currentTurn?.kind === "user" && !currentTurn.verify && !bot.operatorControl) {
                armVerify(bot.id, claimEvidence.note);
              }
            }
          }
          const patched = store.patchMessage(bot.threadId, lastAssistant.id, patch);
          if (patched) broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
          // Propagate the honesty caveat to the shared group copy so a group
          // thread does not present a member's unverified work as confirmed.
          const groupCopyId = groupCopyByMember.get(lastAssistant.id);
          if (groupCopyId) {
            if (patched?.claimEvidence) {
              const gid = turnGroup.get(bot.id);
              const groupThread = gid ? store.bot(gid)?.threadId : undefined;
              if (groupThread) {
                const groupCopy = store.patchMessage(groupThread, groupCopyId, { claimEvidence: patched.claimEvidence });
                if (groupCopy) broadcast({ kind: "message.patch", threadId: groupThread, message: groupCopy });
              }
            }
            groupCopyByMember.delete(lastAssistant.id);
          }
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
      // A budget trip raced off by normal completion must not disarm the
      // ceiling for this bot's future turns.
      budgetStopped.delete(bot.id);
      if (used && used.okNames.length >= 2) {
        const turnWindow = store.messagesFor(bot.threadId).slice(currentTurn?.messageStart ?? 0);
        const userText = [...turnWindow].reverse().find((m) => m.role === "user" && m.kind === "text")?.text ?? "";
        const assistantText = [...turnWindow].reverse().find((m) => m.role === "bot" && m.kind === "text")?.text ?? "";
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
      if (currentTurn?.verify) {
        // Verification-only self-correction — do not ping CoS as a "teammate
        // finished" update; the corrected result is already in this thread.
      } else if (currentTurn?.kind !== "proactive" && currentTurn?.kind !== "completion") {
        const pingedDelegatorId = resolveHandoffPromise(bot.id, turnText);
        const cos = chiefOfStaffBot();
        if (cos && pingedDelegatorId === cos.id) {
          // The CoS was pinged directly as the promised delegator, so skip the
          // generic "[Teammate update]" for this completion — no double turn.
        } else if (currentTurn?.relayResult) {
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

      // Fire a bounded verify-only pass when this turn overstated its work. It
      // runs after the turn fully completes (busy is already false) and does
      // not re-verify itself (the verify turn is marked `verify: true`).
      const verifyCaveat = takeVerify(bot.id);
      if (verifyCaveat && !bot.operatorControl && !currentTurn?.verify) {
        void startTurn(bot.id, verifyPrompt(verifyCaveat), { source: "agent", verify: true }).catch(() => {});
      }

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
      // The user was just promised "I'll show you the answer when it's ready." Do
      // not let that become a silent queue — guarantee the ping-back.
      recordHandoffPromise({ fromBotId: bot.id, fromThreadId: bot.threadId, toBotId: target.id, request: text });
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
    text: `I've asked ${target.name} to handle that. I'll show you the answer when it's ready.`,
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
        tool: { name: `@${target.name} could not start: ${userFacingError(err instanceof Error ? err.message : String(err))}`, ok: false },
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
  const lines = reports.slice(-12).map((r) =>
    `- @${r.name}: ${r.text.slice(0, 700)}${r.caveat ? `\n  ⚠ ${r.caveat}` : ""}`,
  );
  const prompt = `[Teammate update]

A teammate finished work. Reply to Charles as a natural chat message, not a status template. Lead with the concrete result. Mention a blocker only if one exists. Mention a decision only if Charles must make it. Do not use headings such as Answer, Status, Owner, Need from you, Results, Blockers, or Decision. Do not repeat the handoff, routing mechanics, or tool narration. Do not ask what to do next unless Charles must choose something. Keep it to one to three short paragraphs. Do not delegate the report back to the reporting agents. A line that carries an "⚠" honesty caveat means that teammate's work could not be verified to have actually changed state — surface that caveat honestly, and never describe unverified work as done or confirmed.

${lines.join("\n")}`;
  try {
    await startTurn(cos.id, prompt, { source: "completion" });
    if (cos.notifications !== false) {
      broadcast({
        kind: "notify",
        botId: cos.id,
        title: cos.name,
        body: `${cos.name} has an update for you.`,
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
  completionReports.push({
    botId: bot.id,
    name: bot.name,
    text: text.trim(),
    at: Date.now(),
    caveat: claimCaveatForBot(bot.id) || undefined,
  });
  while (completionReports.length > 20) completionReports.shift();
  scheduleCompletionReport();
}

// ── turn dispatch (a turn dispatcher, miniature) ─────────────────────────
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
  budgetStopped.delete(bot.id);
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
  if (bot.busy || turnReservations.has(botId)) throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });
  turnReservations.add(botId);
  const existingJob = opts?.jobId ? getJob(opts.jobId) : null;
  if (opts?.jobId && (!existingJob || existingJob.botId !== bot.id)) {
    turnReservations.delete(botId);
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
    turnReservations.delete(botId);
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
    let fallback;
    try {
      fallback = await defaultSelection();
    } catch (e) {
      turnReservations.delete(botId);
      throw e;
    }
    const fallbackInstance = registry.get(fallback.instanceId);
    if (fallbackInstance) {
      selection = fallback;
      instance = fallbackInstance;
      if (bot.modelSelection.instanceId !== fallback.instanceId || bot.modelSelection.model !== fallback.model) {
        store.patchBot(bot.id, { modelSelection: fallback });
        broadcast({ kind: "bot", bot: store.bot(bot.id) });
      }
    } else {
      turnReservations.delete(botId);
      throw Object.assign(
        new Error("No AI engine is signed in yet. Sign in to one of the supported agent apps, then try again."),
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
    turnReservations.delete(botId);
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
    verify: opts?.verify,
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
  // The busy flag owns concurrency from here; drop the dispatch claim.
  turnReservations.delete(botId);
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

      const claimFeedback = takeClaimFeedback(bot.id);
      const staticSystem = [
        persona,
        ...(claimFeedback ? [claimFeedbackPrompt(claimFeedback)] : []),
        integrations.localComputer
          ? "You can act on the user's computer through the computer tools. Before acting, screenshot or read the desktop/accessibility state to ground yourself. Prefer accessible element targets (for example clicking a UI control by its accessibility index) over raw pixel coordinates whenever the tools expose them, and only fall back to coordinates when an element target is unavailable. Act within the focused app, avoid closing or repositioning windows, and capture a post-action frame to confirm the change actually happened."
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
      // The job row keeps the detail for recovery/Reflexion (model-facing);
      // the transcript gets the sanitized, human-facing sentence.
      console.error(`[harness] dispatch failed for ${bot.name}:`, message);
      updateJob(job.id, { status: "failed", error: message.slice(0, 500) });
      const failure = store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${userFacingError(message)}`, ok: false },
      });
      broadcast({ kind: "message", threadId: bot.threadId, message: failure });
      store.patchBot(bot.id, { busy: false });
      watchdog.end(bot.id);
      turnGroup.delete(bot.id);
      turnMeta.delete(bot.id);
      turnTools.delete(bot.id);
      budgetStopped.delete(bot.id);
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
    // Sweep expired windows so the map cannot grow once per unique remote
    // address for the life of the process.
    for (const [k, row] of pairingAttemptWindows) {
      if (now - row.startedAt >= PAIRING_ATTEMPT_WINDOW_MS) pairingAttemptWindows.delete(k);
    }
    pairingAttemptWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= PAIRING_ATTEMPT_LIMIT) return false;
  current.count += 1;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises -- the handler catches its own errors
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  try {
    const providedToken = tokenFromHarnessRequest(req.headers.authorization, url.searchParams.get("token"));
    // A browser page from another site (or a DNS-rebound domain) must never
    // drive /api even from a loopback socket — that is the whole trust model.
    // Public paths (webhooks, health, the token-gated internal API) are
    // exempt: they carry their own authentication.
    if (path.startsWith("/api/") && !isPublicHarnessPath(method, path) && requestLooksCrossSite(req, BIND)) {
      return json(res, 403, { error: "cross-origin API requests are not allowed" });
    }
    // Connect device tokens authorize the same API surface as the host
    // harness, but only while LAN mode (or an explicit off-loopback bind) is
    // active. Loopback clients remain trusted by the existing harness gate.
    const remoteDevice = remoteAccessEnabled(cfg, BIND) ? authenticateRemoteToken(providedToken) : null;
    const gate = authorizeHarnessRequest(req, method, path, providedToken, checkSteerToken(providedToken));
    const isPairingExchange = method === "POST" && path === "/api/remote-access/pair";
    if (!gate.ok && !remoteDevice && !isPairingExchange) return json(res, 401, { error: gate.error });

    const routeArgs = { req, res, method, path, url, remoteDevice };
    if (await handleInternalRoutes(routeArgs)) return;
    if (await handleBotRoutes(routeArgs)) return;
    if (await handleRoutineRoutes(routeArgs)) return;
    if (await handleAccessRoutes(routeArgs)) return;
    if (await handlePlatformRoutes(routeArgs)) return;

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
        congestedSseClients.delete(res);
        sseClients.delete(res);
      });
      return;
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
      receiptByItem.clear();
      receiptMessage.clear();
      askMessageByRequest.clear();
      groupCopyByMember.clear();
      budgetStopped.clear();
      relayResolvedThreads.clear();
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
    if (method === "GET" && path === "/api/artifacts") {
      return serveArtifact(res, url.searchParams.get("path"));
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

function fireRoutineEvent(r: { id: string; botId: string; name: string; prompt: string }, extra: string): boolean {
  const bot = store.bot(r.botId);
  if (!bot || bot.busy || bot.operatorControl) return false;
  const text = `[Routine: ${r.name}]\n\n${r.prompt}\n\n${extra}`;
  markRan(r.id);
  rememberTurn(r.botId, text, "routine");
  void startTurn(r.botId, text, { source: "routine" }).catch(() => {});
  broadcast({ kind: "routines", routines: publicRoutines() });
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
    broadcast({ kind: "routines", routines: publicRoutines() });
  }
}

function recoverAfterBoot() {
  runDueRoutines();
}

const BIND = process.env.NEXBOT_BIND?.trim() || remoteAccessStatus(cfg).configuredBind;

// ── route-module context ──────────────────────────────────────────────────
// One assignment point: the web/* route modules read harness state from here
// so the HTTP surface can live outside this file.
Object.assign(harness, {
  cfg,
  registry,
  store,
  screens,
  watchdog,
  nonceCache,
  PORT,
  BIND,
  WEB_PORT,
  STATIC_DIR,
  COMMS_TOKEN,
  turnGroup,
  turnMeta,
  groupQueuedTurns,
  agentInbox,
  completionReports,
  proactivePending,
  taskMessageCounts,
  cosReportTimer,
  broadcast,
  startTurn,
  stopActiveTurn,
  drainUserQueue,
  drainAgentInbox,
  queueAgentMessage,
  askBotAndWait,
  appendHandoff,
  authorizeTaskDelegation,
  chiefOfStaffBot,
  defaultSelection,
  normalizeReasoningEffort,
  triggerProactive,
  fireRoutineEvent,
  syncFileWatches,
  reloadProviders,
  patchReceiptMessage,
  allowPairingAttempt,
});
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
  // events/ and native/ NDJSON grow forever without this: the rotation
  // comments promise 14-day retention, so honor it on a daily sweep.
  const hygiene = runDataHygiene();
  const pruned = pruneEventLogs();
  if (hygiene.removed.length || pruned.removed || pruned.rotated) {
    console.log(`nexbot: hygiene — removed ${hygiene.removed.length} legacy file(s), pruned ${pruned.removed} log(s), rotated ${pruned.rotated}.`);
  }
  const dailyPrune = setInterval(() => {
    try {
      pruneEventLogs();
    } catch (e) {
      console.warn("[harness] log prune failed:", e);
    }
  }, 24 * 60 * 60 * 1000);
  dailyPrune.unref?.();
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

// This process hosts every agent child and every SSE client; one stray
// rejection must not take the whole tray backend down. Log it, tell the
// clients, keep running. A second failure within the window means real
// damage — exit before state gets worse.
let lastProcessFailureAt = 0;
function surviveProcessFailure(kind: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[harness] ${kind}:`, error);
  broadcast({ kind: "warning", body: `The harness hit an internal error (${message.slice(0, 120)}) and recovered.` });
  if (Date.now() - lastProcessFailureAt < 5_000) {
    console.error("[harness] repeated internal failures — exiting");
    void registry.disposeAll().finally(() => process.exit(1));
    return;
  }
  lastProcessFailureAt = Date.now();
}
process.on("unhandledRejection", (reason) => surviveProcessFailure("unhandledRejection", reason));
process.on("uncaughtException", (error) => surviveProcessFailure("uncaughtException", error));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Give every child a real chance to die (driver dispose awaits the kill)
    // but never hang shutdown on a zombie process.
    const ceiling = new Promise<void>((resolve) => setTimeout(resolve, 8_000).unref?.());
    void Promise.race([registry.disposeAll(), ceiling]).finally(() => process.exit(0));
  });
}
