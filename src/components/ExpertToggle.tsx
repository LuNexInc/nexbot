import { ListTree } from "lucide-react";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";

/** Shared quick switch for the chat header and the full settings row. */
export function ExpertToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { state, dispatch } = useStore();
  const label = state.expertMode ? "Expert mode on" : "Expert mode off";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={state.expertMode}
      aria-label={label}
      title={state.expertMode ? "Hide reasoning, tools, and steps" : "Show reasoning, tools, and steps"}
      data-active={state.expertMode}
      onClick={() => dispatch({ type: "setExpertMode", enabled: !state.expertMode })}
      className={cn(
        "expert-toggle pressable inline-flex min-h-11 items-center gap-2 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-200",
        state.expertMode
          ? "border-accent/30 bg-accent/10 text-ink"
          : "border-black/8 bg-black/[0.03] text-ink-secondary hover:border-black/15 hover:text-ink",
        className,
      )}
    >
      {!compact && <span>Expert</span>}
      <span aria-hidden="true" className="expert-toggle-orb">
        <ListTree size={17} strokeWidth={2.1} />
      </span>
    </button>
  );
}
