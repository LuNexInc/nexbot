import { useEffect, useState } from "react";
import { useStore, type Bot } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { Search } from "lucide-react";

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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) onClose();
        else dispatch({ type: "toggleAppSettings", open: false }); // close others if needed
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dispatch]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matchingBots = state.bots
    .filter((b) => !b.hidden)
    .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.title ?? "").toLowerCase().includes(q));

  const selectBot = (bot: Bot) => {
    dispatch({ type: "select", id: bot.id });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 backdrop-blur-md bg-black/30 animate-fade-in">
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
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % Math.max(1, matchingBots.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + matchingBots.length) % Math.max(1, matchingBots.length));
              } else if (e.key === "Enter" && matchingBots[highlight]) {
                e.preventDefault();
                selectBot(matchingBots[highlight]);
              }
            }}
            placeholder="Type a command or search bot... (Ctrl+K)"
            className="w-full bg-transparent text-[15px] font-medium text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <kbd className="rounded border border-black/10 bg-black/5 px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary">
            ESC
          </kbd>
        </div>

        {/* Action / Bot List */}
        <div className="max-h-80 overflow-y-auto p-2">
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
                  <div className="text-[14px] font-semibold text-ink truncate">{bot.name}</div>
                  <div className="text-[12px] text-ink-secondary truncate">{bot.title || bot.description || "NexBot"}</div>
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

          {matchingBots.length === 0 && (
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
          </div>
          <span className="font-mono">NexBot Sleek</span>
        </div>
      </div>
    </div>
  );
}

