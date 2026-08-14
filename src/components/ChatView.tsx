import { Component, useEffect, useRef, useState, type ReactNode, type ErrorInfo } from "react";
import { Loader2, ChevronDown, Sparkles } from "lucide-react";
import { useStore, formatTime, type Bot, type Message } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { TodoChecklist } from "./TodoChecklist";
import { ThreadHeader } from "./ThreadHeader";
import { cn } from "@/lib/cn";
import { stripWorkingNarration, extractThinking } from "@/lib/activity";
import type { NexColor } from "@/lib/mascot";

// Minimal markdown for bot bubbles: **bold**, `code`, headings, lists.
// Rendered as React nodes — model output never reaches the DOM as HTML.
import { CodeBlock } from "./CodeBlock";
import { ExecutionRail } from "./ExecutionRail";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ChatErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ChatErrorBoundary caught rendering error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="mx-auto my-4 max-w-[600px] rounded-xl border border-danger/30 bg-danger/5 p-4 text-center text-[13px] text-danger">
            <p className="font-semibold">Unable to render message content.</p>
            <p className="mt-1 text-[12px] opacity-80">{this.state.error?.message ?? "An unexpected rendering error occurred."}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const wordCount = thinking.trim().split(/\s+/).filter(Boolean).length;
  const label = isStreaming && !open ? "Thinking…" : `Thought process (${wordCount} words)`;

  return (
    <div className="flex flex-col items-start my-0.5 max-w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "group flex items-center gap-1.5 rounded-lg border border-black/6 bg-black/[0.03] dark:bg-white/[0.04] px-2.5 py-1 text-[12px] font-medium text-ink-secondary hover:border-black/12 hover:bg-black/6 hover:text-ink transition-all",
          open && "bg-black/6 border-black/12 text-ink rounded-b-none"
        )}
      >
        <Sparkles size={12} className={cn("text-ink-secondary opacity-70 group-hover:opacity-100", isStreaming && "animate-pulse")} />
        <span>{label}</span>
        <ChevronDown size={11} className={cn("text-ink-secondary transition-transform duration-200 opacity-60 group-hover:opacity-100", open && "rotate-180")} />
      </button>

      {open && (
        <div className="w-full rounded-b-lg rounded-tr-lg border border-t-0 border-black/6 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-[13px] leading-relaxed text-ink-secondary/90 max-h-[300px] overflow-y-auto whitespace-pre-wrap font-sans transition-all">
          <div className="border-l-2 border-black/15 pl-2.5 font-sans italic text-ink-secondary">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
}

function inlineMd(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={`${keyBase}-${i++}`} className="rounded bg-black/6 px-1.5 py-0.5 font-mono text-[13px] text-ink">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdownish({ text, botId }: { text: string; botId?: string }) {
  // Check for code blocks
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let blockKey = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const plain = text.slice(lastIdx, match.index);
      blocks.push(renderPlainMarkdown(plain, `plain-${blockKey++}`));
    }
    const lang = match[1] || "text";
    const code = match[2] || "";
    blocks.push(<CodeBlock key={`code-${blockKey++}`} code={code} language={lang} botId={botId} />);
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    blocks.push(renderPlainMarkdown(text.slice(lastIdx), `plain-${blockKey++}`));
  }

  return <>{blocks}</>;
}

function renderPlainMarkdown(text: string, keyBase: string) {
  return (
    <div key={keyBase}>
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return (
            <div key={i} className="mt-2 font-semibold text-ink">
              {inlineMd(heading[1], `h${i}`)}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-ink-secondary">•</span>
              <span className="min-w-0">{inlineMd(bullet[1], `b${i}`)}</span>
            </div>
          );
        }
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-ink-secondary font-mono text-[13px]">{numbered[1]}.</span>
              <span className="min-w-0">{inlineMd(numbered[2], `n${i}`)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <div key={i}>{inlineMd(line, `p${i}`)}</div>;
      })}
    </div>
  );
}

function Bubble({
  message,
  botId,
  onRetry,
}: {
  message: Message;
  botId: string;
  onRetry?: (message: Message) => void;
}) {
  const fromBot = message.fromBot;
  const internal = message.source && message.source !== "user";
  const user = message.role === "user" && !fromBot && !internal;
  const isPending = message.status === "pending";
  const isFailed = message.status === "failed";
  const isHandoff = Boolean(fromBot || internal || (user && message.text?.trim().startsWith("@")));

  const rawText = message.text ?? "";
  const { thinking, cleanText } = user ? { thinking: null, cleanText: rawText } : extractThinking(rawText);

  return (
    <div className={cn("relative flex w-full", user ? "justify-end" : "justify-start")}>
      {/* Visual Handoff Connector Bar */}
      {isHandoff && fromBot && (
        <div className="absolute -top-3 left-4 h-3 w-0.5 bg-gradient-to-b from-transparent to-black/20" />
      )}

      <div className={cn("flex max-w-[75%] flex-col gap-1.5", isPending && "opacity-60")}>
        {fromBot && (
          <div className="flex items-center gap-1.5 px-1">
            <NexAvatar color={(fromBot.color as NexColor) ?? "green"} name={fromBot.name} size={20} />
            <span className="text-[12px] font-semibold text-ink">{fromBot.name}</span>
            <span className="rounded bg-black/6 px-1.5 py-0.2 font-mono text-[10px] text-ink-secondary">Handoff</span>
          </div>
        )}
        {internal && !fromBot && (
          <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
            {message.source === "completion" ? "Completion report" : message.source === "proactive" ? "Proactive check" : "Agent message"}
          </div>
        )}

        {/* Collapsible Thinking Block */}
        {!user && thinking && <ThinkingBlock thinking={thinking} />}

        {(cleanText || user) && (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm transition-all",
              user
                ? isFailed
                  ? "whitespace-pre-wrap border border-danger/30 bg-danger/10 text-danger"
                  : "whitespace-pre-wrap bg-black/10 text-ink"
                : "bg-black/5 text-ink border border-black/5",
            )}
          >
            {user ? message.text : <Markdownish text={cleanText} botId={botId} />}
          </div>
        )}
        {isFailed && onRetry && (
          <div className="flex items-center justify-end gap-1 px-1 text-[11px] text-danger">
            <span>Failed to deliver.</span>
            <button
              onClick={() => onRetry(message)}
              className="font-medium underline hover:text-danger/80"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function isInterAgentMessage(m: Message): boolean {
  if (m.fromBot) return true;
  const text = m.text ?? "";
  return (
    text.startsWith("Handoff from @") ||
    text.startsWith("[Message from @") ||
    text.startsWith("[Group @") ||
    text.startsWith("[Team job") ||
    /^asked\s+@/i.test(m.tool?.name ?? "") ||
    /^@\S+\s*(?:→|->)\s*@/i.test(m.tool?.name ?? "")
  );
}

function groupMessages(messages: Message[]): Array<
  | { type: "single"; message: Message }
  | { type: "cluster"; id: string; messages: Message[]; participants: Array<{ name: string; color?: NexColor }> }
> {
  const result: Array<
    | { type: "single"; message: Message }
    | { type: "cluster"; id: string; messages: Message[]; participants: Array<{ name: string; color?: NexColor }> }
  > = [];

  let currentCluster: Message[] = [];

  const flushCluster = () => {
    if (currentCluster.length === 0) return;
    const textMsgs = currentCluster.filter((m) => m.kind === "text");
    if (textMsgs.length >= 1 && (textMsgs.some(isInterAgentMessage) || currentCluster.length >= 2)) {
      const participantsMap = new Map<string, { name: string; color?: NexColor }>();
      for (const msg of currentCluster) {
        if (msg.fromBot) {
          participantsMap.set(msg.fromBot.name, {
            name: msg.fromBot.name,
            color: msg.fromBot.color as NexColor,
          });
        }
        const match = (msg.text ?? "").match(/(?:Handoff from|\[Message from|\[Group) @([A-Za-z0-9_-]+)/);
        if (match) {
          participantsMap.set(match[1], { name: match[1] });
        }
      }
      const participants = Array.from(participantsMap.values());
      result.push({
        type: "cluster",
        id: `cluster-${currentCluster[0].id}`,
        messages: [...currentCluster],
        participants: participants.length ? participants : [{ name: "Agent" }],
      });
    } else {
      for (const m of currentCluster) {
        result.push({ type: "single", message: m });
      }
    }
    currentCluster = [];
  };

  for (const m of messages) {
    if (m.kind === "activity") {
      if (currentCluster.length > 0) {
        currentCluster.push(m);
        continue;
      }
    }
    if (m.kind === "text" && isInterAgentMessage(m)) {
      currentCluster.push(m);
    } else {
      flushCluster();
      result.push({ type: "single", message: m });
    }
  }
  flushCluster();
  return result;
}

function CommsCluster({
  cluster,
  botId,
  onRetry,
}: {
  cluster: { id: string; messages: Message[]; participants: Array<{ name: string; color?: NexColor }> };
  botId: string;
  onRetry?: (message: Message) => void;
}) {
  const [open, setOpen] = useState(false);
  const textMessages = cluster.messages.filter((m) => m.kind === "text");
  const count = textMessages.length || cluster.messages.length;
  const first = cluster.messages[0];
  const participantNames = cluster.participants.map((p) => p.name).join(", ");

  return (
    <div className="my-2 flex w-full flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "group flex items-center gap-2.5 rounded-full border border-black/8 bg-black/[0.03] dark:bg-white/[0.04] px-4 py-1.5 text-[13px] font-medium text-ink-secondary hover:border-black/15 hover:bg-black/6 hover:text-ink transition-all shadow-xs",
          open && "bg-black/8 text-ink border-black/15"
        )}
      >
        <span className="flex -space-x-1.5 items-center">
          {cluster.participants.slice(0, 3).map((p, idx) => (
            <span key={p.name + idx} className="rounded-full ring-2 ring-surface shrink-0">
              <NexAvatar
                color={p.color ?? "blue"}
                name={p.name}
                size={18}
              />
            </span>
          ))}
        </span>
        <span className="font-semibold text-ink">
          {count} {count === 1 ? "message" : "messages"} with {cluster.participants.length > 1 ? `${cluster.participants.length} agents` : participantNames}
        </span>
        <span className="text-[11px] opacity-60">
          • {formatTime(first.at)}
        </span>
        <ChevronDown size={13} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-2.5 flex w-full max-w-[840px] flex-col gap-2.5 rounded-2xl border border-black/8 bg-black/[0.02] dark:bg-white/[0.02] p-4 transition-all animate-fadeIn">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary px-1">
            Inter-Agent Dialogue ({participantNames})
          </div>
          {cluster.messages.map((m) => {
            if (m.kind === "activity") return null;
            const shown = stripWorkingNarration(m.text ?? "");
            if (!shown) return null;
            return (
              <Bubble
                key={m.id}
                message={shown === m.text ? m : { ...m, text: shown }}
                botId={botId}
                onRetry={onRetry}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  return (
    <div className="flex justify-start">
      <img
        src={`data:${mime ?? "image/png"};base64,${png}`}
        alt="Bot's screen"
        className="max-w-[70%] rounded-2xl border border-hairline/40"
      />
    </div>
  );
}

function StreamingBubble({ text, botId }: { text: string; botId?: string }) {
  const { thinking, cleanText } = extractThinking(text);
  const isOnlyThinking = Boolean(thinking && !cleanText);

  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[75%] flex-col gap-1">
        {thinking && <ThinkingBlock thinking={thinking} isStreaming={isOnlyThinking} />}
        {cleanText ? (
          <div className="rounded-2xl bg-black/6 px-4 py-2.5 text-[15px] leading-relaxed text-ink shadow-sm">
            <Markdownish text={cleanText} botId={botId} />
            <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
          </div>
        ) : isOnlyThinking ? null : (
          <div className="rounded-2xl bg-black/6 px-4 py-2.5 text-[15px] leading-relaxed text-ink shadow-sm">
            <Markdownish text={text} botId={botId} />
            <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
          </div>
        )}
      </div>
    </div>
  );
}

function BusyDots() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl bg-raised px-4 py-3">
        <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:300ms]" />
      </div>
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const streaming = state.streaming[bot.threadId];
  const provisioning = state.provisioning[bot.id];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, bot.messages.length, streaming, bot.busy]);

  const grouped = groupMessages(bot.messages);
  let lastTimeAt = 0;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-transparent">
      <ThreadHeader bot={bot} />

      {/* Error banner */}
      {state.error && (
        <div className="mx-auto w-full max-w-[900px] px-5">
          <div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </div>
        </div>
      )}

      {/* Messages */}
      <ChatErrorBoundary>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
          <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4">
            {grouped.map((item, idx) => {
              const handleRetry = (msg: Message) => {
                if (msg.clientNonce) {
                  dispatch({ type: "retryMessage", botId: bot.id, clientNonce: msg.clientNonce });
                }
              };

              const itemAt = item.type === "cluster" ? item.messages[0]?.at : item.message.at;
              const showTimeDivider = idx === 0 || (itemAt && itemAt - lastTimeAt > 15 * 60_000);
              if (itemAt) lastTimeAt = itemAt;

              return (
                <div key={item.type === "cluster" ? item.id : item.message.id} className="flex flex-col gap-2">
                  {showTimeDivider && itemAt && (
                    <div className="py-2.5 text-center text-[12px] font-medium text-ink-secondary">
                      Today {formatTime(itemAt)}
                    </div>
                  )}

                  {item.type === "cluster" ? (
                    <CommsCluster cluster={item} botId={bot.id} onRetry={handleRetry} />
                  ) : (
                    (() => {
                      const m = item.message;
                      switch (m.kind) {
                        case "options":
                          return <OptionCard key={m.id} botId={bot.id} message={m} />;
                        case "activity":
                          return null;
                        case "screen":
                          return m.png ? <ScreenFrame key={m.id} png={m.png} mime={m.mime} /> : null;
                        default: {
                          if (m.role === "bot") {
                            const shown = stripWorkingNarration(m.text ?? "");
                            if (!shown) return null;
                            return (
                              <Bubble
                                key={m.id}
                                message={shown === m.text ? m : { ...m, text: shown }}
                                botId={bot.id}
                                onRetry={handleRetry}
                              />
                            );
                          }
                          return <Bubble key={m.id} message={m} botId={bot.id} onRetry={handleRetry} />;
                        }
                      }
                    })()
                  )}
                </div>
              );
            })}
            {provisioning && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
                  <Loader2 size={13} className="animate-spin" />
                  Setting up this bot's computer…
                </div>
              </div>
            )}
            {/* Live Execution Rail for active / recent tool calls */}
            <ExecutionRail messages={bot.messages} botId={bot.id} />

            {streaming ? (
              stripWorkingNarration(streaming) ? (
                <StreamingBubble text={stripWorkingNarration(streaming)} botId={bot.id} />
              ) : (
                bot.busy && <BusyDots />
              )
            ) : (
              bot.busy && <BusyDots />
            )}
          </div>
        </div>
      </ChatErrorBoundary>

      <TodoChecklist items={bot.todos ?? []} />
      <Composer bot={bot} />
    </main>
  );
}
