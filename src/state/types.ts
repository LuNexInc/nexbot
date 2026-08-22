// Shared client types for the server-backed store.
import type { NexColor, NexExpression, NexMotion } from "@/lib/mascot";

export type { NexColor } from "@/lib/mascot";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  /** Mask the free-text answer (API keys, tokens). */
  secret?: boolean;
  risk?: "low" | "medium" | "high" | "critical";
  riskReason?: string;
}
export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen";
  text?: string;
  /** Provider reasoning summary, kept out of the main answer bubble. */
  reasoning?: string;
  /** Effort metrics shown in the collapsed reasoning disclosure. */
  effort?: TurnEffort;
  card?: OptionCardData;
  /** activity messages: tool name + outcome */
  tool?: {
    name: string;
    ok?: boolean;
    durationMs?: number;
    output?: string;
    error?: string;
    input?: unknown;
    receiptId?: string;
    evidence?: "not_requested" | "pending" | "changed" | "unchanged" | "unavailable";
  };
  /** screen messages: a frame of the bot's computer (base64) */
  png?: string;
  mime?: string;
  /** teammate speaking in this thread (ask_bot / A2A) */
  fromBot?: { id: string; name: string; color?: string };
  /** why an internal message was added to the transcript */
  source?: "user" | "agent" | "routine" | "proactive" | "completion";
  at: number;
  /** client nonce for optimistic send and deduplication */
  clientNonce?: string;
  /** delivery status for optimistic UI */
  status?: "pending" | "confirmed" | "failed";
  /** attached files kept for retry, or local artifacts attached by a bot */
  files?: Array<{ name: string; data?: string; path?: string; mime?: string }>;
  /** Claim-vs-evidence honesty signal for an assistant reply. Present only when
   * the turn's receipts contradict or cannot confirm the reply's claim. */
  claimEvidence?: {
    verdict: "verified" | "partially_verified" | "unverified";
    note: string;
    flagged: number;
  };
}

export interface TurnEffort {
  durationMs?: number;
  reasoningTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCount?: number;
  cost?: number | null;
}

/** Provider reasoning budget for the next turn. Auto uses the provider default. */
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

export type Theme = "light" | "dark";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface ModelSelection {
  instanceId: string;
  model: string;
  /** Optional per-bot reasoning budget. Older bots omit this and use auto. */
  reasoningEffort?: ReasoningEffort;
}

export interface Bot {
  id: string;
  threadId: string;
  name: string;
  title: string;
  description: string;
  /** Optional talking-style guidance layered into the bot persona. */
  personality?: string;
  notifications: boolean;
  color: NexColor;
  mascotExpression?: NexExpression | null;
  unread: boolean;
  busy?: boolean;
  operatorControl?: boolean;
  modelSelection: ModelSelection;
  /** Where this bot's computer runs; unset = auto (cloud box if one exists, else local). */
  computer?: "cloud" | "local" | "off";
  pinned?: boolean;
  hidden?: boolean;
  memoryEnabled?: boolean;
  /** null/missing = all desk skills on; string[] = only those slugs for this bot. */
  enabledSkillSlugs?: string[] | null;
  kind?: "bot" | "group";
  memberIds?: string[];
  usage?: { input: number; output: number };
  /** Time to first token in milliseconds from last turn */
  lastTtfrMs?: number;
  proactiveEnabled?: boolean;
  completionPings?: boolean;
  /** Stable specialist order in the sidebar. Chief of Staff is always first. */
  sortOrder?: number;
  /** Live durable checklist from the todo tool. */
  todos?: TodoItem[];
  messages: Message[];
}

export interface Routine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  kind?: "cron" | "webhook" | "file";
  webhookSecret?: string;
  githubRepo?: string;
  watchPath?: string;
  everyMinutes?: number;
  dailyAt?: string;
  weekdaysOnly?: boolean;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

/** GET /api/config — configured flags only; secrets are never echoed. */
export interface ConfigStatus {
  xai?: { configured: boolean };
  composio: { configured: boolean; apiKeyConfigured?: boolean };
  box: { configured: boolean };
  /** local profile and workspace brand — collected in onboarding, shown in the sidebar */
  profile?: { name: string; email: string; companyName?: string };
  remoteAccess?: RemoteAccessStatus;
  /** local data directory path (settings About panel) */
  dataDir?: string;
  /** whether the local destructive wipe password is configured */
  wipeConfigured?: boolean;
  version?: string;
  platform?: string;
  logs?: { native: boolean; maxBytes: number; retainDays: number };
}

export interface RemoteDeviceStatus {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  tokenPrefix: string;
  active: boolean;
}

export interface RemoteAccessStatus {
  mode: "off" | "lan";
  enabled: boolean;
  bind: string;
  configuredBind: string;
  restartRequired: boolean;
  port: number;
  lanAddresses: string[];
  devices: RemoteDeviceStatus[];
}

export interface WireGuardStatus {
  available: boolean;
  configured: boolean;
  active: boolean;
  endpoint: string;
  listenPort: number;
  address: string;
  peerCount: number;
  reason?: string;
}

/** One row of GET /api/instances — the model picker's data. */
export interface InstanceInfo {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: {
    state: "available" | "unavailable";
    reason?: string;
    authenticated?: boolean;
    version?: string | null;
  };
  models: { default: string; options: Array<{ id: string; label: string }> };
}

export interface AppState {
  bots: Bot[];
  instances: InstanceInfo[];
  config: ConfigStatus | null;
  selectedId: string;
  /** Show reasoning, tool traces, and other execution details in chat. */
  expertMode: boolean;
  /** App color theme, persisted locally per desktop profile. */
  theme: Theme;
  settingsOpen: boolean;
  /** Which agent settings page opens when the panel is shown. */
  settingsPage: "overview" | "identity";
  pluginsOpen: boolean;
  computerOpen: boolean;
  appSettingsOpen: boolean;
  skillsOpen: boolean;
  /** in-flight assistant text per threadId (content.delta fold) */
  streaming: Record<string, string>;
  /** in-flight provider reasoning per threadId, kept separate from the answer */
  streamingReasoning: Record<string, string>;
  /** latest live frame of a bot's computer, per botId */
  screens: Record<string, { png: string; mime: string }>;
  /** bots whose cloud computer is being provisioned */
  provisioning: Record<string, boolean>;
  connected: boolean;
  error: string | null;
  /** transient warnings scoped to their owning bot */
  botErrors: Record<string, string>;
  mascotMotion: {
    botId: string;
    nonce: number;
    kind: Exclude<NexMotion, "none">;
  } | null;
}

export type Action =
  | { type: "hydrate"; bots: Bot[] }
  | { type: "instances"; instances: InstanceInfo[] }
  | { type: "configStatus"; config: ConfigStatus }
  | { type: "setExpertMode"; enabled: boolean }
  | { type: "setTheme"; theme: Theme }
  | { type: "select"; id: string }
  | { type: "send"; botId: string; text: string; clientNonce?: string; delivery?: "queue" | "steer" | "replace"; files?: Array<{ name: string; data?: string; path?: string }> }
  | { type: "answerCard"; botId: string; messageId: string; answer: string }
  | { type: "dismissCard"; botId: string; messageId: string }
  | {
      type: "newBot";
      name?: string;
      title?: string;
      description?: string;
      personality?: string;
      color?: NexColor;
      kind?: "bot" | "group";
      memberIds?: string[];
      modelSelection?: ModelSelection;
    }
  | { type: "botAdded"; bot: Bot }
  | { type: "deleteBot"; botId: string }
  | { type: "duplicateBot"; botId: string }
  | { type: "markUnread"; botId: string }
  | { type: "botPatched"; bot: Partial<Bot> & { id: string } }
  | { type: "messageAdded"; threadId: string; message: Message }
  | { type: "messagePatched"; threadId: string; message: Message }
  | { type: "messageFailed"; threadId: string; clientNonce: string }
  | { type: "retryMessage"; botId: string; clientNonce: string }
  | { type: "streamDelta"; threadId: string; delta: string }
  | { type: "reasoningDelta"; threadId: string; delta: string }
  | { type: "streamClear"; threadId: string }
  | { type: "todosUpdated"; botId: string; items: TodoItem[] }
  | { type: "screenFrame"; botId: string; png: string; mime: string }
  | { type: "provisioning"; botId: string; on: boolean }
  | { type: "setModel"; botId: string; selection: ModelSelection }
  | { type: "interrupt"; botId: string }
  | { type: "connected"; value: boolean }
  | { type: "error"; message: string | null }
  | { type: "botError"; botId: string; message: string }
  | { type: "clearBotError"; botId: string }
  | { type: "wipe" }
  | { type: "toggleSettings"; open?: boolean; page?: "overview" | "identity" }
  | { type: "togglePlugins"; open?: boolean }
  | { type: "toggleComputer"; open?: boolean }
  | { type: "toggleAppSettings"; open?: boolean }
  | { type: "toggleSkills"; open?: boolean }
  | { type: "previewMascotMotion"; botId: string; kind: Exclude<NexMotion, "none"> }
  | {
      type: "updateBot";
      botId: string;
      patch: Partial<
        Pick<
          Bot,
          "name" | "title" | "description" | "personality" | "notifications" | "computer" | "color" | "mascotExpression" | "pinned" | "hidden" | "memoryEnabled" | "enabledSkillSlugs" | "memberIds" | "proactiveEnabled" | "completionPings" | "sortOrder"
        >
      >;
    };
