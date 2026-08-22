import { BookMarked, Download, Loader2, Monitor, PanelLeft, Square } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { NexAvatar } from "./Avatar";
import { ModelPicker } from "./ModelPicker";
import { ExpertToggle } from "./ExpertToggle";
import { ThemeToggle } from "./ThemeToggle";
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

/** Full transcript for export. The chat view hydrates only the most recent
 * window, so page the whole history from the server before serializing. */
async function fullTranscript(bot: Bot): Promise<Bot["messages"]> {
  if (!bot.hasEarlier && (bot.messageCount ?? bot.messages.length) <= bot.messages.length) {
    return bot.messages;
  }
  const out = [...bot.messages];
  for (let page = 0; page < 50; page++) {
    const before = out[0]?.id;
    if (!before) break;
    try {
      const res = await fetch(`/api/bots/${bot.id}/messages?limit=500&before=${encodeURIComponent(before)}`);
      if (!res.ok) break;
      const body = await res.json();
      const messages: Bot["messages"] = Array.isArray(body?.messages) ? body.messages : [];
      if (!messages.length) break;
      out.unshift(...messages);
      if (!body.hasEarlier) break;
    } catch {
      break; // export what is loaded rather than nothing
    }
  }
  return out;
}

/** Serialize the thread to Markdown and download it client-side. */
async function exportThreadMarkdown(bot: Bot): Promise<void> {
  const messages = await fullTranscript(bot);
  const lines: string[] = [
    `# ${bot.name} — conversation export`,
    ``,
    `Exported ${new Date().toLocaleString()} · NexBot v${__APP_VERSION__}`,
    ``,
  ];
  for (const m of messages) {
    if (m.kind !== "text" || !m.text?.trim()) continue;
    const who = m.role === "user" ? "You" : (m.fromBot?.name ?? bot.name);
    const at = new Date(m.at).toLocaleString();
    lines.push(`**${who}** · ${at}`, ``, m.text.trim(), ``, `---`, ``);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ThreadHeader({ bot, onToggleSidebar }: { bot: Bot; onToggleSidebar?: () => void }) {
  const { state, dispatch } = useStore();
  const ttfr = bot.lastTtfrMs;
  const mascot = state.mascotMotion?.botId === bot.id ? state.mascotMotion : undefined;

  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div className="flex min-w-0 items-center gap-1">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="pressable hidden min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-black/6 hover:text-ink max-[900px]:inline-flex"
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <PanelLeft size={18} />
          </button>
        )}
        <button
          onClick={() => dispatch({ type: "toggleSettings" })}
          className="pressable flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-black/6"
          title="Bot settings"
        >
          <NexAvatar
            color={bot.color}
            name={bot.name}
            size={28}
            motion={mascot?.kind ?? (bot.busy ? "thinking" : undefined)}
            motionKey={mascot?.nonce}
          />
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">{bot.name}</span>
          {bot.kind === "group" && (
            <span className="hidden text-[12px] text-ink-secondary sm:inline">{bot.memberIds?.length ?? 0} NexBots</span>
          )}
          {bot.busy && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {state.expertMode && bot.usage && (bot.usage.input > 0 || bot.usage.output > 0) && (
          <span className="rounded-full bg-black/6 px-2 py-0.5 text-[11px] text-ink-secondary" title="Tokens this turn">
            {bot.usage.input + bot.usage.output} tok
          </span>
        )}
        {bot.messages.length > 0 && (
          <button
            onClick={() => void exportThreadMarkdown(bot)}
            className="pressable rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            title="Export conversation as Markdown"
            aria-label="Export conversation as Markdown"
          >
            <Download size={16} />
          </button>
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
            {state.expertMode && ttfr !== undefined && ttfr > 0 && <TtfrChip ms={ttfr} />}
          </div>
        )}
        {bot.kind === "group" && state.expertMode && ttfr !== undefined && ttfr > 0 && <TtfrChip ms={ttfr} />}
        <ThemeToggle />
        <ExpertToggle compact />
        {bot.kind !== "group" && (
          <button
            onClick={() => dispatch({ type: "toggleComputer" })}
            className={cn(
              "min-h-11 min-w-11 rounded-md p-1.5 hover:bg-raised",
              state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title="Bot's computer"
            aria-label="Bot's computer"
          >
            <Monitor size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
