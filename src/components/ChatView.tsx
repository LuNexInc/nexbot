import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type ErrorInfo } from "react";
import { Loader2, ChevronDown, MessageCircle, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useStore, formatTime, type Bot, type Message, type TurnEffort } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { TodoChecklist } from "./TodoChecklist";
import { ThreadHeader } from "./ThreadHeader";
import { cn } from "@/lib/cn";
import { isLowValueSystemMessage, stripWorkingNarration, extractThinking } from "@/lib/activity";
import { onSpeakingChange, speakingMessageId, textForSpeech, toggleSpeak, stopSpeaking } from "@/lib/voice";
import type { NexColor } from "@/lib/mascot";

// Minimal markdown for bot bubbles: **bold**, `code`, headings, lists.
// Rendered as React nodes — model output never reaches the DOM as HTML.
import { CodeBlock } from "./CodeBlock";
import { ExecutionRail } from "./ExecutionRail";
import { normalizeMarkdown, parseMarkdownTable } from "@/lib/markdown";

interface ArtifactOpen {
  reference: string;
  name?: string;
  mime?: string;
}

const ARTIFACT_EVENT = "nexbot:open-artifact";

function artifactSrc(reference: string): string {
  return `/api/artifacts?path=${encodeURIComponent(reference)}`;
}

function emitArtifactOpen(artifact: ArtifactOpen) {
  window.dispatchEvent(new CustomEvent<ArtifactOpen>(ARTIFACT_EVENT, { detail: artifact }));
}

function artifactIsImage(artifact: ArtifactOpen): boolean {
  if (artifact.mime?.startsWith("image/")) return true;
  return /\.(?:png|jpe?g|webp|gif|avif|svg)(?:$|[?#])/i.test(artifact.reference);
}

function ArtifactDialog({ artifact, onClose }: { artifact: ArtifactOpen; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={artifact.name ?? "Artifact preview"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[92vh] max-w-[min(1100px,96vw)] flex-col overflow-hidden rounded-2xl border border-white/20 bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-black/8 px-4 py-3 text-[13px] font-medium text-ink">
          <span className="truncate">{artifact.name ?? "Artifact preview"}</span>
          <button type="button" onClick={onClose} className="pressable rounded-lg px-2.5 py-1.5 text-ink-secondary hover:bg-black/6 hover:text-ink" aria-label="Close artifact preview">Close</button>
        </div>
        {artifactIsImage(artifact) ? (
          <img src={artifactSrc(artifact.reference)} alt={artifact.name ?? "Artifact"} className="max-h-[calc(92vh-58px)] max-w-[min(1100px,96vw)] object-contain" />
        ) : (
          <iframe title={artifact.name ?? "Artifact preview"} src={artifactSrc(artifact.reference)} sandbox="" className="h-[calc(92vh-58px)] min-h-[420px] w-[min(1000px,92vw)] bg-white" />
        )}
      </div>
    </div>
  );
}

function ArtifactGallery({ files }: { files?: Message["files"] }) {
  const artifacts = (files ?? []).filter((file): file is { name: string; path: string; mime?: string } => Boolean(file.path));
  if (!artifacts.length) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {artifacts.map((file) => {
        const artifact = { reference: file.path, name: file.name, mime: file.mime };
        return (
          <button
            key={file.path}
            type="button"
            onClick={() => emitArtifactOpen(artifact)}
            className="pressable group overflow-hidden rounded-xl border border-black/8 bg-card text-left shadow-xs transition-colors hover:border-accent/45"
            aria-label={`Open ${file.name}`}
          >
            {artifactIsImage(artifact) ? (
              <img src={artifactSrc(file.path)} alt="" className="aspect-[16/10] w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]" />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-black/[0.035] px-4 text-center text-[13px] text-ink-secondary">Open document</div>
            )}
            <span className="block truncate px-3 py-2 text-[12px] font-medium text-ink">{file.name}</span>
          </button>
        );
      })}
    </div>
  );
}

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

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function effortLabel(effort?: TurnEffort, wordCount?: number, isStreaming?: boolean): string {
  if (isStreaming && !effort) return "Reasoning";
  const parts = ["Reasoning"];
  if (effort?.reasoningTokens) parts.push(`${formatTokenCount(effort.reasoningTokens)} tokens`);
  else if (wordCount) parts.push(`${wordCount} words`);
  if (effort?.toolCount) parts.push(`${effort.toolCount} tools`);
  if (effort?.durationMs) parts.push(formatDuration(effort.durationMs));
  return parts.join(" · ");
}

function ThinkingBlock({
  thinking,
  effort,
  isStreaming,
}: {
  thinking?: string;
  effort?: TurnEffort;
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const body = thinking?.trim() ?? "";
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const label = effortLabel(effort, wordCount, isStreaming && !open);

  return (
    <div className="flex flex-col items-start my-0.5 max-w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "pressable group flex min-h-11 items-center gap-1.5 rounded-lg border border-black/6 bg-black/[0.03] dark:bg-white/[0.04] px-2.5 py-1 text-[12px] font-medium text-ink-secondary transition-colors hover:border-black/12 hover:bg-black/6 hover:text-ink",
          open && "bg-black/6 border-black/12 text-ink rounded-b-none"
        )}
      >
        <Sparkles size={12} className="text-ink-secondary opacity-70 group-hover:opacity-100" />
        <span>{label}</span>
        <ChevronDown size={11} className={cn("text-ink-secondary transition-transform duration-200 opacity-60 group-hover:opacity-100", open && "rotate-180")} />
      </button>

      {open && (
        <div className="animate-popover-in w-full rounded-b-lg rounded-tr-lg border border-t-0 border-black/6 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-[13px] leading-relaxed text-ink-secondary/90 max-h-[300px] overflow-y-auto whitespace-pre-wrap font-sans">
          <div className="border-l-2 border-black/15 pl-2.5 font-sans italic text-ink-secondary">
            {body || "No reasoning text was provided for this turn."}
          </div>
        </div>
      )}
    </div>
  );
}

function inlineMd(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\[[^\]]+\]\((?:https?:\/\/|mailto:|file:\/\/\/|desk:\/\/)[^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("[")) {
      const link = tok.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:|file:\/\/\/|desk:\/\/)[^)]+)\)$/);
      if (link) {
        const local = /^(?:file:\/\/\/|desk:\/\/)/i.test(link[2]);
        parts.push(
          <a
            key={`${keyBase}-${i++}`}
            href={local ? artifactSrc(link[2]) : link[2]}
            target={local ? undefined : "_blank"}
            rel={local ? undefined : "noreferrer"}
            onClick={local ? (event) => { event.preventDefault(); emitArtifactOpen({ reference: link[2], name: link[1] }); } : undefined}
            className="font-medium text-accent underline decoration-accent/35 underline-offset-2 hover:decoration-accent"
          >
            {link[1]}
          </a>,
        );
      } else {
        parts.push(tok);
      }
    } else if (tok.startsWith("**")) {
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

function renderTableCell(
  value: string,
  cellIndex: number,
  headers: string[],
  keyBase: string,
): React.ReactNode {
  const header = headers[cellIndex]?.trim().toLowerCase() ?? "";
  const when = value.match(/^(.+?)\s+(\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?)$/);
  if (cellIndex === 0 && /^(when|date|time)$/.test(header) && when) {
    return (
      <>
        <span className="block font-medium text-ink">{inlineMd(when[1], `${keyBase}-date`)}</span>
        <span className="mt-1 block whitespace-nowrap tabular-nums text-[12px] font-medium text-ink-secondary">
          {when[2]}
        </span>
      </>
    );
  }
  return inlineMd(value, keyBase);
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
      blocks.push(renderPlainMarkdown(normalizeMarkdown(plain), `plain-${blockKey++}`));
    }
    const lang = match[1] || "text";
    const code = match[2] || "";
    blocks.push(<CodeBlock key={`code-${blockKey++}`} code={code} language={lang} botId={botId} />);
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    blocks.push(renderPlainMarkdown(normalizeMarkdown(text.slice(lastIdx)), `plain-${blockKey++}`));
  }

  return <>{blocks}</>;
}

function renderPlainMarkdown(text: string, keyBase: string) {
  const lines = text.split("\n");
  const content: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const table = parseMarkdownTable(lines, i);
    if (table) {
      if (table.prefix) {
        content.push(
          <div key={`${keyBase}-table-prefix-${i}`}>
            {inlineMd(table.prefix, `${keyBase}-table-prefix-${i}`)}
          </div>,
        );
      }
      content.push(
        <div key={`${keyBase}-table-${i}`} className="my-3 max-w-full overflow-hidden rounded-2xl border border-black/8 bg-card shadow-xs">
          <div className="max-w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left text-[13px] leading-snug">
              <thead className="bg-black/[0.035] text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                <tr>
                  {table.headers.map((cell, cellIndex) => (
                    <th
                      key={cellIndex}
                      scope="col"
                      className={cn(
                        "border-b border-black/8 px-3.5 py-2.5",
                        cellIndex === 0 && "w-[27%]",
                        cellIndex === 1 && "w-[31%]",
                      )}
                    >
                      {inlineMd(cell, `${keyBase}-th-${i}-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-black/6 odd:bg-black/[0.018] last:border-b-0 hover:bg-black/[0.045]">
                    {table.headers.map((_, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={cn(
                          "break-words px-3.5 py-3 align-top text-ink",
                          cellIndex === 0 && "w-[27%]",
                          cellIndex === 1 && "w-[31%]",
                        )}
                      >
                        {renderTableCell(
                          row[cellIndex] ?? "",
                          cellIndex,
                          table.headers,
                          `${keyBase}-td-${i}-${rowIndex}-${cellIndex}`,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>,
      );
      i = table.nextIndex;
      continue;
    }

    const line = lines[i];
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      // Some providers collapse a quoted paragraph as `> text >`; the final
      // marker is a delimiter, not part of the sentence.
      const quoteText = quote[1].replace(/\s+>\s*$/, "");
      content.push(
        <blockquote key={`${keyBase}-${i}`} className="border-l-2 border-black/15 pl-3 text-ink-secondary">
          {inlineMd(quoteText, `${keyBase}-q-${i}`)}
        </blockquote>,
      );
      i += 1;
      continue;
    }
    if (/^\s*(?:\*\s*){3,}$/.test(line) || /^\s*(?:-\s*){3,}$/.test(line) || /^\s*(?:_\s*){3,}$/.test(line)) {
      content.push(<hr key={`${keyBase}-${i}`} className="my-3 border-black/10" />);
      i += 1;
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      content.push(
        <div key={`${keyBase}-${i}`} className="mt-4 border-b border-black/8 pb-1.5 pt-1 first:mt-1 font-semibold text-ink">
          {inlineMd(heading[1], `${keyBase}-h-${i}`)}
        </div>,
      );
      i += 1;
      continue;
    }
    const inlineHeading = line.match(/^(.*?)\s+(#{1,4})\s+(.+)$/);
    if (inlineHeading && inlineHeading[1].trim()) {
      content.push(
        <div key={`${keyBase}-${i}-prefix`}>{inlineMd(inlineHeading[1].trim(), `${keyBase}-p-${i}`)}</div>,
      );
      content.push(
        <div key={`${keyBase}-${i}-heading`} className="mt-4 border-b border-black/8 pb-1.5 pt-1 first:mt-1 font-semibold text-ink">
          {inlineMd(inlineHeading[3], `${keyBase}-h-${i}`)}
        </div>,
      );
      i += 1;
      continue;
    }
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    if (bullet) {
      content.push(
        <div key={`${keyBase}-${i}`} className="flex gap-2 pl-1">
          <span className="text-ink-secondary">•</span>
          <span className="min-w-0">{inlineMd(bullet[1], `${keyBase}-b-${i}`)}</span>
        </div>,
      );
      i += 1;
      continue;
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numbered) {
      content.push(
        <div key={`${keyBase}-${i}`} className="flex gap-2 pl-1">
          <span className="font-mono text-[13px] text-ink-secondary">{numbered[1]}.</span>
          <span className="min-w-0">{inlineMd(numbered[2], `${keyBase}-n-${i}`)}</span>
        </div>,
      );
      i += 1;
      continue;
    }
    if (!line.trim()) {
      content.push(<div key={`${keyBase}-${i}`} className="h-2" />);
    } else {
      content.push(<div key={`${keyBase}-${i}`}>{inlineMd(line, `${keyBase}-p-${i}`)}</div>);
    }
    i += 1;
  }

  return (
    <div key={keyBase} className="min-w-0">
      {content}
    </div>
  );
}

/** Read-aloud toggle for one bot bubble. Hidden when there is nothing to say. */
function SpeakButton({ messageId, text }: { messageId: string; text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const speech = useMemo(() => textForSpeech(text), [text]);
  useEffect(() => {
    if (!speech) return;
    const sync = (id: string | null) => setSpeaking(id === messageId);
    sync(speakingMessageId());
    return onSpeakingChange(sync);
  }, [messageId, speech]);
  if (!speech) return null;
  return (
    <button
      type="button"
      onClick={() => toggleSpeak(messageId, text)}
      className={cn(
        "pressable flex h-7 items-center gap-1 rounded-full border border-black/6 bg-black/[0.03] dark:bg-white/[0.04] px-2.5 text-[11px] font-medium transition-colors",
        speaking
          ? "border-accent/40 bg-accent/10 text-accent"
          : "text-ink-secondary hover:border-black/12 hover:bg-black/6 hover:text-ink",
      )}
      title={speaking ? "Stop reading aloud" : "Read aloud"}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
    >
      {speaking ? <VolumeX size={12} /> : <Volume2 size={12} />}
      <span>{speaking ? "Stop" : "Listen"}</span>
    </button>
  );
}

const THINKING_TIERS: Array<{ afterS: number; phrase: string }> = [
  { afterS: 0, phrase: "is thinking" },
  { afterS: 8, phrase: "is working through it" },
  { afterS: 25, phrase: "is still on it" },
  { afterS: 60, phrase: "is on a longer one — still here" },
];

function thinkingPhrase(elapsedS: number): string {
  let phrase = THINKING_TIERS[0].phrase;
  for (const tier of THINKING_TIERS) if (elapsedS >= tier.afterS) phrase = tier.phrase;
  return phrase;
}

/** Human presence line while a turn runs: who, and a phrase that ages well.
 * Replaces bare dots — the wait should feel like a person pausing to think. */
function ThinkingLine({ name, color }: { name: string; color?: NexColor }) {
  const [elapsedS, setElapsedS] = useState(0);
  useEffect(() => {
    const start = Date.now();
    setElapsedS(0);
    const timer = setInterval(() => setElapsedS(Math.floor((Date.now() - start) / 1000)), 3000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex justify-start">
      <div className="flex min-h-11 items-center gap-2 rounded-full border border-black/6 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-1">
        <NexAvatar color={(color as NexColor) ?? "blue"} name={name} size={20} motion="working" motionKey={name.length} />
        <span className="text-[13px] text-ink-secondary">
          {name} {thinkingPhrase(elapsedS)}
          <span className="ml-0.5 inline-flex gap-0.5 align-middle">
            <span className="size-1 animate-bounce rounded-full bg-ink-secondary/70 [animation-delay:0ms]" />
            <span className="size-1 animate-bounce rounded-full bg-ink-secondary/70 [animation-delay:150ms]" />
            <span className="size-1 animate-bounce rounded-full bg-ink-secondary/70 [animation-delay:300ms]" />
          </span>
        </span>
      </div>
    </div>
  );
}

function Bubble({
  message,
  botId,
  expertMode,
  onRetry,
}: {
  message: Message;
  botId: string;
  expertMode: boolean;
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
        {expertMode && !user && (thinking || message.reasoning || message.effort) && (
          <ThinkingBlock thinking={message.reasoning ?? thinking ?? undefined} effort={message.effort} />
        )}

        {(cleanText || user || message.files?.length) && (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm transition-colors",
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
        {!user && !isPending && message.kind === "text" && cleanText.trim() && (
          <div className="px-1">
            <SpeakButton messageId={message.id} text={cleanText} />
          </div>
        )}
        {!user && <ArtifactGallery files={message.files} />}
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

function groupMessages(messages: Message[], expertMode = true): Array<
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
    if (isLowValueSystemMessage(m)) continue;
    if (!expertMode && (m.kind === "activity" || m.kind === "screen")) continue;
    if (m.kind === "activity") {
      if (currentCluster.length > 0) {
        currentCluster.push(m);
      }
      // Tool activity is rendered once by ExecutionRail. Do not add a
      // zero-height message row here, because the parent flex gap would still
      // reserve vertical space for every tool step.
      continue;
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
  expertMode,
  onRetry,
}: {
  cluster: { id: string; messages: Message[]; participants: Array<{ name: string; color?: NexColor }> };
  botId: string;
  expertMode: boolean;
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
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} conversation with ${participantNames}`}
        className={cn(
          "pressable group flex min-h-11 items-center gap-2.5 rounded-full border border-black/8 bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors shadow-xs",
          "hover:border-black/15 hover:bg-black/6 hover:text-ink",
          open && "bg-black/8 text-ink border-black/15"
        )}
      >
        <MessageCircle size={14} className="shrink-0 text-accent" />
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
          {expertMode
            ? `${count} ${count === 1 ? "message" : "messages"} with ${cluster.participants.length > 1 ? `${cluster.participants.length} agents` : participantNames}`
            : `${count === 1 ? "Handoff" : "Handoffs"} · ${participantNames}`}
        </span>
        <span className="text-[11px] opacity-60">
          • {formatTime(first.at)}
        </span>
        <ChevronDown size={13} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="animate-popover-in mt-2.5 flex w-full max-w-[840px] flex-col gap-2.5 rounded-2xl border border-black/8 bg-black/[0.02] dark:bg-white/[0.02] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary px-1">
            NexBot conversation · {participantNames}
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
                expertMode={expertMode}
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

/** Ambient presence: tiny avatars of teammates currently working. Glanceable,
 * wordless — the CoS narrates progress in chat; the UI never does. */
function WorkingPresence({ bots, currentBotId }: { bots: Bot[]; currentBotId: string }) {
  const working = bots.filter((b) => b.busy && !b.hidden && b.kind !== "group" && b.id !== currentBotId);
  if (!working.length) return null;
  return (
    <div className="pointer-events-auto flex items-center justify-end gap-1 px-4 pb-1">
      {working.map((b) => (
        <span key={b.id} title={`@${b.name} is working`} aria-label={`@${b.name} is working`}>
          <NexAvatar color={b.color} name={b.name} size={20} motion="working" motionKey={b.id.length} />
        </span>
      ))}
    </div>
  );
}

function StreamingBubble({ text, reasoning, botId, expertMode, name, color }: { text: string; reasoning?: string; botId?: string; expertMode: boolean; name?: string; color?: NexColor }) {
  const extracted = extractThinking(text);
  const thinking = [reasoning, extracted.thinking].filter(Boolean).join("\n\n");
  const visibleThinking = expertMode ? thinking : "";
  const cleanText = stripWorkingNarration(extracted.cleanText);
  const isOnlyThinking = Boolean(visibleThinking && !cleanText);

  if (!visibleThinking && !cleanText) return name ? <ThinkingLine name={name} color={color} /> : null;

  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[75%] flex-col gap-1">
        {visibleThinking && <ThinkingBlock thinking={visibleThinking} isStreaming={isOnlyThinking} />}
        {cleanText ? (
          <div className="rounded-2xl bg-black/6 px-4 py-2.5 text-[15px] leading-relaxed text-ink shadow-sm">
            <Markdownish text={cleanText} botId={botId} />
            <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
          </div>
        ) : isOnlyThinking ? null : (
          <div className="rounded-2xl bg-black/6 px-4 py-2.5 text-[15px] leading-relaxed text-ink shadow-sm">
            <Markdownish text={cleanText || extracted.cleanText} botId={botId} />
            <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatView({ bot, onToggleSidebar }: { bot: Bot; onToggleSidebar?: () => void }) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [artifact, setArtifact] = useState<ArtifactOpen | null>(null);

  const streaming = state.streaming[bot.threadId];
  const streamingReasoning = state.streamingReasoning[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  const previousBotId = useRef<string | null>(null);
  const initializedThreads = useRef(new Set<string>());
  const errorMessage = state.error ?? state.botErrors[bot.id];

  useEffect(() => {
    const onArtifact = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactOpen>).detail;
      if (detail?.reference) setArtifact(detail);
    };
    window.addEventListener(ARTIFACT_EVENT, onArtifact);
    // Leaving the thread (or the app) should never leave a voice talking.
    return () => {
      window.removeEventListener(ARTIFACT_EVENT, onArtifact);
      stopSpeaking();
    };
  }, []);
  useEffect(() => {
    stopSpeaking();
  }, [bot.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const switchedBot = previousBotId.current !== bot.id;
    previousBotId.current = bot.id;
    const firstContentLoad = bot.messages.length > 0 && !initializedThreads.current.has(bot.id);
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldAnchorLatest = switchedBot || firstContentLoad;
    if (!shouldAnchorLatest && distanceFromBottom > 240) return;
    if (shouldAnchorLatest) {
      // Refresh hydration and browser scroll restoration can finish after the
      // first paint. Re-anchor a few times so the latest message wins without
      // fighting the user's scroll position during normal live updates.
      if (bot.messages.length > 0) initializedThreads.current.add(bot.id);
      const anchor = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
      requestAnimationFrame(anchor);
      window.setTimeout(anchor, 80);
      window.setTimeout(anchor, 240);
      return;
    }
    const frame = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [bot.id, bot.messages.length, bot.busy, streaming ? Math.floor(streaming.length / 160) : 0, streamingReasoning ? Math.floor(streamingReasoning.length / 160) : 0]);

  const grouped = groupMessages(bot.messages, state.expertMode);
  let lastTimeAt = 0;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-transparent">
      <ThreadHeader bot={bot} onToggleSidebar={onToggleSidebar} />

      {/* Error banner */}
      {errorMessage && (
        <div className="mx-auto w-full max-w-[900px] px-5">
          <div role="alert" aria-live="polite" className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {errorMessage}
          </div>
        </div>
      )}

      {/* Messages */}
      <ChatErrorBoundary>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
          <div className="mx-auto flex max-w-[900px] flex-col gap-2 pb-4">
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
                    <CommsCluster cluster={item} botId={bot.id} expertMode={state.expertMode} onRetry={handleRetry} />
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
                                expertMode={state.expertMode}
                                onRetry={handleRetry}
                              />
                            );
                          }
                          return <Bubble key={m.id} message={m} botId={bot.id} expertMode={state.expertMode} onRetry={handleRetry} />;
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
            {/* Current-turn execution rail; older activity stays available to search. */}
            {state.expertMode && <ExecutionRail messages={bot.messages} botId={bot.id} />}

            {streaming || streamingReasoning ? (
              <StreamingBubble text={streaming ?? ""} reasoning={streamingReasoning} botId={bot.id} expertMode={state.expertMode} name={bot.name} color={bot.color} />
            ) : (
              bot.busy && <ThinkingLine name={bot.name} color={bot.color} />
            )}
          </div>
        </div>
      </ChatErrorBoundary>

      {state.expertMode && <TodoChecklist items={bot.todos ?? []} />}
      <WorkingPresence bots={state.bots} currentBotId={bot.id} />
      <Composer bot={bot} />
      {artifact && <ArtifactDialog artifact={artifact} onClose={() => setArtifact(null)} />}
    </main>
  );
}
