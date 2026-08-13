import { useEffect, useRef } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useStore, formatTime, type Bot, type Message } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { ThreadHeader } from "./ThreadHeader";
import { cn } from "@/lib/cn";
import { isGutsActivity, stripWorkingNarration } from "@/lib/activity";
import type { NexColor } from "@/lib/mascot";

// Minimal markdown for bot bubbles: **bold**, `code`, headings, lists.
// Rendered as React nodes — model output never reaches the DOM as HTML.
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
        <code key={`${keyBase}-${i++}`} className="rounded bg-inset px-1 py-px text-[13px]">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdownish({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return (
            <div key={i} className="mt-1.5 font-semibold">
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
              <span className="text-ink-secondary">{numbered[1]}.</span>
              <span className="min-w-0">{inlineMd(numbered[2], `n${i}`)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-2.5" />;
        return <div key={i}>{inlineMd(line, `p${i}`)}</div>;
      })}
    </>
  );
}

function Bubble({
  message,
  onRetry,
}: {
  message: Message;
  onRetry?: (message: Message) => void;
}) {
  const fromBot = message.fromBot;
  const user = message.role === "user" && !fromBot;
  const isPending = message.status === "pending";
  const isFailed = message.status === "failed";
  return (
    <div className={cn("flex w-full", user ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[70%] flex-col gap-1", isPending && "opacity-60")}>
        {fromBot && (
          <div className="flex items-center gap-1.5 px-0.5">
            <NexAvatar color={(fromBot.color as NexColor) ?? "green"} name={fromBot.name} size={18} />
            <span className="text-[12px] font-medium text-ink-secondary">{fromBot.name}</span>
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
            user
              ? isFailed
                ? "whitespace-pre-wrap border border-danger/30 bg-danger/10 text-danger"
                : "whitespace-pre-wrap bg-black/12 text-ink"
              : "bg-black/6 text-ink",
          )}
        >
          {user ? message.text : <Markdownish text={message.text ?? ""} />}
        </div>
        {isFailed && onRetry && (
          <div className="flex items-center justify-end gap-1 px-1 text-[11px] text-danger">
            <span>Failed to send.</span>
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

/** A tool run: spinner while live, check/cross once settled. */
function ActivityChip({ message }: { message: Message }) {
  const tool = message.tool;
  if (!tool) return null;
  const failed = tool.ok === false;
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-black/10 bg-black/6 px-3 py-1.5 text-[13px]",
          failed ? "text-danger" : "text-ink-secondary",
        )}
      >
        {tool.ok === undefined ? (
          <Loader2 size={13} className="animate-spin" />
        ) : failed ? (
          <X size={13} />
        ) : (
          <Check size={13} className="text-success" />
        )}
        <span className="max-w-[480px] truncate font-mono">{tool.name}</span>
      </div>
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

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[70%] rounded-2xl bg-black/6 px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <Markdownish text={text} />
        <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
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

  const first = bot.messages[0];

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4">
          {first && (
            <div className="py-3 text-center text-[13px] text-ink-secondary">
              Today {formatTime(first.at)}
            </div>
          )}
          {bot.messages.map((m) => {
            const handleRetry = (msg: Message) => {
              if (msg.clientNonce) {
                dispatch({ type: "retryMessage", botId: bot.id, clientNonce: msg.clientNonce });
              }
            };
            switch (m.kind) {
              case "options":
                return <OptionCard key={m.id} botId={bot.id} message={m} />;
              case "activity":
                return isGutsActivity(m) ? null : <ActivityChip key={m.id} message={m} />;
              case "screen":
                return m.png ? <ScreenFrame key={m.id} png={m.png} mime={m.mime} /> : null;
              default: {
                if (m.role === "bot") {
                  const shown = stripWorkingNarration(m.text ?? "");
                  if (!shown) return null;
                  return <Bubble key={m.id} message={shown === m.text ? m : { ...m, text: shown }} onRetry={handleRetry} />;
                }
                return <Bubble key={m.id} message={m} onRetry={handleRetry} />;
              }
            }
          })}
          {provisioning && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
                <Loader2 size={13} className="animate-spin" />
                Setting up this bot's computer…
              </div>
            </div>
          )}
          {streaming ? (
            stripWorkingNarration(streaming) ? (
              <StreamingBubble text={stripWorkingNarration(streaming)} />
            ) : (
              bot.busy && <BusyDots />
            )
          ) : (
            bot.busy && <BusyDots />
          )}
        </div>
      </div>

      <Composer bot={bot} />
    </main>
  );
}
