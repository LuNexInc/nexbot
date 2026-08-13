import { BookMarked, Loader2, Monitor, Square } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { ModelPicker } from "./ModelPicker";
import { cn } from "@/lib/cn";

function TtfrChip({ ms }: { ms: number }) {
  return (
    <span
      className="rounded-full bg-black/6 px-2 py-0.5 text-[11px] font-mono text-ink-secondary"
      title="Time to first token"
    >
      {ms}ms TTFR
    </span>
  );
}

export function ThreadHeader({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const ttfr = bot.lastTtfrMs;

  return (
    <div className="flex items-center justify-between px-5 py-3">
      <button
        onClick={() => dispatch({ type: "toggleSettings" })}
        className="pressable flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-black/6"
        title="Bot settings"
      >
        <NexAvatar color={bot.color} name={bot.name} size={28} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">{bot.name}</span>
        {bot.kind === "group" && (
          <span className="text-[12px] text-ink-secondary">{bot.memberIds?.length ?? 0} teammates</span>
        )}
        {bot.busy && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
      </button>
      <div className="flex items-center gap-2">
        {bot.usage && (bot.usage.input > 0 || bot.usage.output > 0) && (
          <span className="rounded-full bg-black/6 px-2 py-0.5 text-[11px] text-ink-secondary" title="Tokens this turn">
            {bot.usage.input + bot.usage.output} tok
          </span>
        )}
        {bot.messages.some((m) => m.role === "user") && (
          <button
            onClick={() =>
              api("/api/skills/from-turn", { method: "POST", body: JSON.stringify({ botId: bot.id }) }).then(() =>
                dispatch({ type: "toggleSkills", open: true }),
              )
            }
            className="pressable rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            title="Save last turn as skill"
          >
            <BookMarked size={16} />
          </button>
        )}
        {bot.busy && (
          <button
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="pressable flex items-center gap-1.5 rounded-full border border-black/12 bg-black/6 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-black/10 hover:text-ink"
            title="Stop this turn"
          >
            <Square size={12} className="fill-current" />
            Stop
          </button>
        )}
        {bot.kind !== "group" && (
          <div className="flex items-center gap-1.5">
            <ModelPicker bot={bot} />
            {ttfr !== undefined && ttfr > 0 && <TtfrChip ms={ttfr} />}
          </div>
        )}
        {bot.kind === "group" && ttfr !== undefined && ttfr > 0 && <TtfrChip ms={ttfr} />}
        {bot.kind !== "group" && (
          <button
            onClick={() => dispatch({ type: "toggleComputer" })}
            className={cn(
              "rounded-md p-1.5 hover:bg-raised",
              state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title="Bot's computer"
          >
            <Monitor size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
