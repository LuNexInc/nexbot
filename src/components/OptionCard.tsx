import { useState } from "react";
import { X, ChevronRight, ChevronDown, ShieldCheck, AlertCircle } from "lucide-react";
import { useStore, type Message } from "@/state/store";
import { cn } from "@/lib/cn";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function OptionCard({
  botId,
  message,
}: {
  botId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const [custom, setCustom] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const card = message.card;
  if (!card || card.dismissed) return null;

  const secret =
    Boolean(card.secret) || /secret|token|password|api key|apikey/i.test(`${card.title} ${card.subtitle}`);

  const isAlwaysAllowed = /always allowed|auto-allowed|pre-approved/i.test(card.subtitle ?? "");

  const answer = (text: string) => {
    if (!text.trim()) return;
    dispatch({ type: "answerCard", botId, messageId: message.id, answer: text.trim() });
  };

  return (
    <div className="w-full max-w-[840px] rounded-2xl border border-black/10 bg-black/[0.03] dark:bg-white/[0.04] p-4.5 shadow-sm transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{card.title}</h3>
            {card.answered ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck size={12} />
                {card.answered}
              </span>
            ) : isAlwaysAllowed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Always allowed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                <AlertCircle size={11} />
                Approval required
              </span>
            )}
          </div>
          {card.subtitle && (
            <p className="text-[13.5px] leading-relaxed text-ink-secondary">
              {card.subtitle}
            </p>
          )}
        </div>
        <button
          onClick={() => dispatch({ type: "dismissCard", botId, messageId: message.id })}
          aria-label="Dismiss card"
          className="rounded-lg p-1 text-ink-secondary hover:bg-black/8 hover:text-ink transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Expandable details disclosure */}
      <div className="mt-2.5">
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[12px] font-medium text-ink-secondary hover:text-ink transition-colors"
        >
          {showDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{showDetails ? "Hide the details" : "Show the details"}</span>
        </button>
        {showDetails && (
          <div className="mt-2 rounded-xl border border-black/8 bg-black/5 dark:bg-white/5 p-3 text-[12px] font-mono text-ink-secondary">
            <div><strong>Request ID:</strong> {card.requestId || message.id}</div>
            {card.options?.length > 0 && (
              <div className="mt-1">
                <strong>Available Actions:</strong> {card.options.join(", ")}
              </div>
            )}
            <div className="mt-1">
              <strong>Timestamp:</strong> {new Date(message.at).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>

      {card.options && card.options.length > 0 && (
        <div className="mt-3.5 overflow-hidden rounded-xl border border-black/10 bg-surface">
          {card.options.map((opt, i) => (
            <button
              key={opt}
              disabled={Boolean(card.answered)}
              onClick={() => answer(opt)}
              className={cn(
                "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[14px] text-ink transition-colors",
                i > 0 && "border-t border-black/6",
                card.answered === opt
                  ? "bg-black/8 font-medium"
                  : "hover:bg-black/4 disabled:hover:bg-transparent",
              )}
            >
              <span className="flex size-5.5 items-center justify-center rounded-md bg-black/6 text-[11px] font-semibold text-ink-secondary">
                {LETTERS[i] ?? i + 1}
              </span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      )}

      {!card.answered && (
        <input
          type={secret ? "password" : "text"}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && answer(custom)}
          placeholder={secret ? "Paste secret (stays masked)" : "Type your own answer..."}
          autoComplete="off"
          className="mt-3 w-full rounded-xl border border-black/10 bg-surface px-3.5 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-ink"
        />
      )}
    </div>
  );
}
