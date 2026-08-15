import { Moon, Sun } from "lucide-react";
import { useStore, type Theme } from "@/state/store";
import { cn } from "@/lib/cn";

/** Compact light/dark switch. The icons stay visible so the control is clear without a tooltip. */
export function ThemeToggle({ compact = true, className }: { compact?: boolean; className?: string }) {
  const { state, dispatch } = useStore();
  const dark = state.theme === "dark";
  const nextTheme: Theme = dark ? "light" : "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      data-dark={dark}
      onClick={() => dispatch({ type: "setTheme", theme: nextTheme })}
      className={cn(
        "theme-toggle pressable inline-flex min-h-11 items-center gap-2 rounded-full border px-2.5 text-[12px] font-medium text-ink-secondary transition-colors hover:text-ink",
        className,
      )}
    >
      {!compact && <span>{dark ? "Dark" : "Light"}</span>}
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-spark theme-toggle-spark-one" />
        <span className="theme-toggle-spark theme-toggle-spark-two" />
        <span className="theme-toggle-orb">
          <Sun size={11} className="theme-toggle-sun" strokeWidth={2.2} />
          <Moon size={11} className="theme-toggle-moon" strokeWidth={2.2} />
        </span>
      </span>
    </button>
  );
}
