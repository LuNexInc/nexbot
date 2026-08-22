import { useEffect, useRef, useState } from "react";
import { useStore, type Bot } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { MessageSquareText, Search } from "lucide-react";

interface SearchHit {
  messageId: string;
  threadId: string;
  botId?: string | null;
  botName?: string;
  text: string;
  at: number;
}

/** First ~140 chars of a hit with the query's first match anchored in view. */
function snippet(text: string, q: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const idx = clean.toLowerCase().indexOf(q.split(/\s+/)[0]?.toLowerCase() ?? "");
  if (idx < 0) return clean.slice(0, 140) + (clean.length > 140 ? "…" : "");
  const start = Math.max(0, idx - 50);
  return (start > 0 ? "…" : "") + clean.slice(start, start + 150);
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Global Escape close — must not depend on focus living in the input.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced transcript + memory-fact search over the harness FTS index.
  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => setHits(Array.isArray(data?.results) ? data.results.slice(0, 8) : []))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, open]);

  // Agents first, then message hits — one flat list so arrows stay simple.
  const q = query.trim().toLowerCase();
  const matchingBots = state.bots
    .filter((b) => !b.hidden)
    .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.title ?? "").toLowerCase().includes(q));
  const flatCount = matchingBots.length + hits.length;

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const selectBot = (bot: Bot) => {
    dispatch({ type: "select", id: bot.id });
    onClose();
  };

  const selectHit = (hit: SearchHit) => {
    const target = hit.botId
      ? state.bots.find((b) => b.id === hit.botId)
      : state.bots.find((b) => b.threadId === hit.threadId);
    if (target) selectBot(target);
  };

  const pickFlat = (index: number) => {
    if (index < matchingBots.length) selectBot(matchingBots[index]);
    else selectHit(hits[index - matchingBots.length]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 backdrop-blur-md bg-black/30 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass-floating w-full max-w-[540px] overflow-hidden rounded-2xl shadow-2xl animate-spring-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 border-b border-black/8 px-4 py-3.5">
          <Search size={18} className="text-ink-secondary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % Math.max(1, flatCount));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + Math.max(1, flatCount)) % Math.max(1, flatCount));
              } else if (e.key === "Enter" && flatCount > 0) {
                e.preventDefault();
                pickFlat(Math.min(highlight, flatCount - 1));
              }
            }}
            placeholder="Search agents and conversations… (Ctrl+K)"
            className="w-full bg-transparent text-[15px] font-medium text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <kbd className="rounded border border-black/10 bg-black/5 px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary">
            ESC
          </kbd>
        </div>

        {/* Action / Bot / Message results */}
        <div className="max-h-96 overflow-y-auto p-2">
          <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
            Agents ({matchingBots.length})
          </div>
          {matchingBots.map((bot, i) => (
            <button
              key={bot.id}
              onClick={() => selectBot(bot)}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors",
                i === highlight ? "bg-black/8" : "hover:bg-black/4",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <NexAvatar color={bot.color} name={bot.name} size={28} />
                <div className="min-w-0 truncate">
                  <div className="truncate text-[14px] font-semibold text-ink">{bot.name}</div>
                  <div className="truncate text-[12px] text-ink-secondary">{bot.title || bot.description || "NexBot"}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {i < 9 && (
                  <kbd className="rounded border border-black/10 bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">
                    {i + 1}
                  </kbd>
                )}
              </div>
            </button>
          ))}

          {(query.trim().length >= 2 || hits.length > 0) && (
            <>
              <div className="mt-1 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                <MessageSquareText size={11} />
                Messages {searching ? "…" : `(${hits.length})`}
              </div>
              {!searching && hits.length === 0 && query.trim().length >= 2 && (
                <div className="px-3 py-2 text-[12px] text-ink-secondary">No messages matched.</div>
              )}
              {hits.map((hit, i) => {
                const flatIndex = matchingBots.length + i;
                return (
                  <button
                    key={`${hit.messageId}-${i}`}
                    onClick={() => selectHit(hit)}
                    onMouseEnter={() => setHighlight(flatIndex)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
                      flatIndex === highlight ? "bg-black/8" : "hover:bg-black/4",
                    )}
                  >
                    <span className="text-[12px] font-semibold text-accent">
                      {hit.botName ?? "Conversation"}
                    </span>
                    <span className="truncate text-[13px] text-ink">{snippet(hit.text, query.trim())}</span>
                  </button>
                );
              })}
            </>
          )}

          {flatCount === 0 && query.trim().length < 2 && (
            <div className="py-6 text-center text-[13px] text-ink-secondary">
              No matching agents or commands found
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between border-t border-black/6 bg-black/3 px-4 py-2 text-[11px] text-ink-secondary">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>? Shortcuts</span>
          </div>
          <span className="font-mono">NexBot</span>
        </div>
      </div>
    </div>
  );
}
