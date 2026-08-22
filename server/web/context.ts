// Shared harness state for the route modules. index.ts populates this once
// at boot; route modules read it per request (destructure inside handlers —
// module top-level runs before the bootstrap assigns anything).
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppConfig } from "../config.ts";
import type { ModelSelection, ReasoningEffort } from "../contracts.ts";
import type { ProviderRegistry } from "../harness/registry.ts";
import type { Store } from "../store.ts";
import type { ExecutionReceipt } from "../execution-evidence.ts";
import type { ProactiveReason } from "../proactivity.ts";
import type { StoredAgentMessage } from "../agent-inbox.ts";
import type { TaskContext, TaskDelegation } from "../task-context.ts";
import type { ScreenPoller } from "../screen-poller.ts";
import type { Watchdog } from "../watchdog.ts";
import type { NonceCache } from "../nonce.ts";

export type CompletionReport = { botId: string; name: string; text: string; at: number };

/** Mirrors the startTurn options accepted by the harness turn pipeline. */
export type StartTurnOpts = {
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

export interface TurnMeta {
  kind: "user" | "agent" | "routine" | "proactive" | "completion";
  messageStart: number;
  startedAt: number;
  sourceBotId?: string;
  jobId?: string;
  relayResult?: boolean;
  reasoningText?: string;
  reasoningTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface HarnessContext {
  cfg: AppConfig;
  registry: ProviderRegistry;
  store: Store;
  screens: ScreenPoller;
  watchdog: Watchdog;
  nonceCache: NonceCache;

  PORT: number;
  BIND: string;
  WEB_PORT: number;
  STATIC_DIR: string | null;
  COMMS_TOKEN: string;

  turnGroup: Map<string, string>;
  turnMeta: Map<string, TurnMeta>;
  groupQueuedTurns: Map<string, Array<{ text: string; groupId: string }>>;
  agentInbox: Map<string, StoredAgentMessage[]>;
  completionReports: CompletionReport[];
  proactivePending: Map<string, Set<ProactiveReason>>;
  taskMessageCounts: Map<string, number>;
  cosReportTimer: ReturnType<typeof setTimeout> | undefined;

  broadcast(payload: unknown): void;
  startTurn(botId: string, text: string, opts?: StartTurnOpts): Promise<unknown>;
  stopActiveTurn(botId: string, reason: string): Promise<void>;
  drainUserQueue(botId: string): void;
  drainAgentInbox(botId: string): void;
  queueAgentMessage(targetBotId: string, item: StoredAgentMessage): number;
  askBotAndWait(fromBotId: string, toBotId: string, message: string, taskContext: TaskContext, opts?: Record<string, unknown>): Promise<string>;
  appendHandoff(opts: { from: { id: string; name: string; color?: string } | null; to: { id: string; name: string; color?: string }; text: string }): void;
  authorizeTaskDelegation(context: TaskContext, fromBotId: string, targetBotId: string): TaskDelegation | { error: string };
  chiefOfStaffBot(): ReturnType<Store["bot"]>;
  defaultSelection(): Promise<ModelSelection>;
  normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined;
  triggerProactive(botId: string, reason: ProactiveReason, context?: string): void;
  fireRoutineEvent(r: { id: string; botId: string; name: string; prompt: string }, extra: string): boolean;
  syncFileWatches(): void;
  reloadProviders(): Promise<void>;
  patchReceiptMessage(receipt: ExecutionReceipt): void;
  allowPairingAttempt(req: IncomingMessage): boolean;
}

/** Populated by index.ts before listen(); route modules read it per request. */
export const harness = {} as HarnessContext;

export type RouteArgs = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  url: URL;
  /** Set when a Connect device token authorized this request. */
  remoteDevice: unknown;
};
