import { track } from "@/lib/analytics";
import { useEffect, useState } from "react";
import {
  BellDot,
  ClipboardCopy,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Puzzle,
  Trash2,
  Users,
  BookOpen,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { NexAvatar, InitialsAvatar } from "./Avatar";
import { NexMark } from "./NexMark";
import { cn } from "@/lib/cn";

const isElectron = navigator.userAgent.includes("Electron");

function isChiefOfStaffBot(bot: Bot): boolean {
  const n = bot.name.trim().toLowerCase();
  const t = (bot.title ?? "").trim().toLowerCase();
  return n === "chief of staff" || n === "luna" || t.includes("chief of staff");
}
/** "Ada Lovelace" → "AL", "ada" → "A", "you@x.dev" → "Y", unset → "?" */
function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

function preview(bot: Bot): string {
  if (bot.busy) return "Working…";
  const last = bot.messages[bot.messages.length - 1];
  if (!last) return "";
  if (last.kind === "options" && last.card) return last.card.title;
  if (last.kind === "activity" && last.tool) return last.tool.name;
  if (last.kind === "screen") return "Screen frame";
  return last.text ?? "";
}

/** Roster search: name / title / description / last-message preview only. */
function matchesQuery(bot: Bot, q: string): boolean {
  if (!q) return true;
  const fields = [bot.name, bot.title, bot.description, preview(bot)];
  return fields.some((f) => (f ?? "").trim().toLowerCase().includes(q));
}

interface MenuState {
  botId: string;
  x: number;
  y: number;
}

function BotContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((b) => b.id === menu.botId);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-bot-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (!bot) return null;
  // keep the menu on-screen near the click
  const top = Math.min(menu.y, window.innerHeight - 340);
  const left = Math.min(menu.x, window.innerWidth - 240);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick?: () => void,
    opts?: { danger?: boolean; disabled?: boolean; hint?: string },
  ) => (
    <button
      key={label}
      disabled={opts?.disabled}
      onClick={() => {
        onClick?.();
        onClose();
      }}
      title={opts?.hint}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]",
        opts?.danger ? "text-danger" : "text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-raised/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 border-t border-hairline/40" />;

  return (
    <div
      data-bot-menu
      style={{ top, left }}
      className="glass-heavy fixed z-40 w-[228px] overflow-hidden rounded-xl py-1.5 shadow-2xl shadow-black/50"
    >
      {[
        item(
          bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
          bot.pinned ? "Unpin" : "Pin",
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
        ),
        item(<BellDot size={16} className="text-ink-secondary" />, "Mark as Unread", () =>
          dispatch({ type: "markUnread", botId: bot.id }),
        ),
        divider("d1"),
        item(<Pencil size={16} className="text-ink-secondary" />, "Edit Profile", () => {
          dispatch({ type: "select", id: bot.id });
          dispatch({ type: "toggleSettings", open: true });
        }),
        item(<Copy size={16} className="text-ink-secondary" />, "Duplicate", () =>
          dispatch({ type: "duplicateBot", botId: bot.id }),
        ),
        divider("d2"),
        item(<ClipboardCopy size={16} className="text-ink-secondary" />, "Copy conversation ID", () => {
          void navigator.clipboard?.writeText(bot.threadId);
        }),
        divider("d3"),
        item(
          <EyeOff size={16} className="text-ink-secondary" />,
          "Hide from sidebar",
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { hidden: true } }),
          isChiefOfStaffBot(bot)
            ? { disabled: true, hint: "Chief of Staff stays on the desk" }
            : undefined,
        ),
        item(<Trash2 size={16} />, "Delete", () => {
          if (window.confirm(`Delete ${bot.name}? This removes the agent and its chat.`)) {
            dispatch({ type: "deleteBot", botId: bot.id });
          }
        }, {
          danger: true,
        }),
      ]}
    </div>
  );
}

function renderSubtitle(bot: Bot) {
  const pendingCard = bot.messages.find((m) => m.kind === "options" && m.card && !m.card.answered && !m.card.dismissed);
  if (pendingCard?.card) {
    return (
      <span className="truncate text-[12px] font-medium text-amber-600 dark:text-amber-400">
        Approval required: {pendingCard.card.title}
      </span>
    );
  }
  if (bot.busy) {
    const lastUser = [...bot.messages].reverse().find((m) => m.role === "user");
    return (
      <span className="truncate text-[12px] text-ink-secondary italic">
        Draft: {lastUser?.text ? lastUser.text.slice(0, 30) : "in progress…"}
      </span>
    );
  }
  return (
    <span className="truncate text-[12px] text-ink-secondary font-normal">
      {preview(bot)}
    </span>
  );
}

function BotListItem({
  bot,
  index,
  onMenu,
}: {
  bot: Bot;
  index?: number;
  onMenu: (menu: MenuState) => void;
}) {
  const { state, dispatch } = useStore();
  const selected = state.selectedId === bot.id;
  const mascot = state.mascotMotion?.botId === bot.id ? state.mascotMotion : undefined;
  return (
    <button
      onClick={() => dispatch({ type: "select", id: bot.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
      }}
      className={cn(
        "pressable relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
        selected
          ? "bg-black/8 shadow-sm font-semibold"
          : "hover:bg-black/4",
      )}
    >
      <div className="relative">
        <NexAvatar
          color={bot.color}
          name={bot.name}
          size={38}
          motion={mascot?.kind}
          motionKey={mascot?.nonce}
        />
        {bot.busy && (
          <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500 animate-pulse" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[14px] font-semibold text-ink">
            {bot.pinned && <Pin size={11} className="shrink-0 text-ink-secondary" />}
            <span className="truncate">{bot.name}</span>
          </span>
          {index !== undefined && index < 9 && (
            <kbd className="shrink-0 rounded border border-black/8 bg-black/4 px-1 text-[10px] font-mono text-ink-secondary opacity-60">
              {index + 1}
            </kbd>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          {renderSubtitle(bot)}
          <span className="flex shrink-0 items-center gap-1">
            {bot.busy && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                Live
              </span>
            )}
            {bot.unread && (
              <span className="rounded-full bg-ink px-1.5 py-0.5 text-[9px] font-semibold text-white animate-spring-pop">
                New
              </span>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
      {children}
    </div>
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [hiddenQuery, setHiddenQuery] = useState("");
  const [meetOpen, setMeetOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [meetName, setMeetName] = useState("");
  const [meetJob, setMeetJob] = useState("");
  const [meetAbout, setMeetAbout] = useState("");
  const [teamName, setTeamName] = useState("Team");
  const [teamPick, setTeamPick] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const visibleBots = state.bots
    .filter((b) => !b.hidden)
    .filter((b) => matchesQuery(b, q))
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
  const pinnedBots = visibleBots.filter((b) => b.pinned);
  const restBots = visibleBots.filter((b) => !b.pinned);

  const hq = hiddenQuery.trim().toLowerCase();
  const hiddenBots = state.bots.filter((b) => b.hidden);
  const hiddenMatches = hiddenBots.filter((b) => {
    if (!hq) return true;
    return b.name.trim().toLowerCase().includes(hq);
  });

  const down = state.instances.filter((i) => i.snapshot.state !== "available");

  return (
    <aside className="glass-heavy flex h-full w-[300px] shrink-0 flex-col border-r border-black/8">
      {/* Titlebar: real traffic lights in Electron, faux ones in the browser */}
      <div
        className="flex items-center justify-between px-4 pt-3.5 pb-1"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 text-ink">
          {isElectron && <div className="w-14" />}
          <NexMark className="size-5" />
          <span className="text-[13px] font-medium tracking-tight">NexBot</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={() => setTeamOpen(true)}
            className="pressable rounded-md p-1 text-ink-secondary hover:bg-black/5 hover:text-ink"
            title="New group thread"
          >
            <Users size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => setMeetOpen(true)}
            className="pressable rounded-md p-1 text-ink-secondary hover:bg-black/5 hover:text-ink"
            title="New teammate"
          >
            <Plus size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-3">
        <div className="flex items-center gap-2 rounded-full bg-black/4 px-3 py-2">
          <Search size={16} className="text-ink-secondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bots and chats"
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>
      </div>

      {/* Bot list */}
      <div className="flex-1 overflow-y-auto px-2">
        {pinnedBots.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {pinnedBots.map((b, i) => (
                <BotListItem key={b.id} bot={b} index={i} onMenu={setMenu} />
              ))}
            </div>
          </>
        )}
        <div className={cn("flex flex-col gap-0.5", pinnedBots.length > 0 && "mt-1")}>
          {restBots.map((b, i) => (
            <BotListItem
              key={b.id}
              bot={b}
              index={pinnedBots.length + i}
              onMenu={setMenu}
            />
          ))}
        </div>
      </div>

      {q && visibleBots.length === 0 && (
        <div className="px-4 pb-2 text-[12px] text-ink-secondary">No matches</div>
      )}

      {/* Footer */}
      <div className="px-3 pb-3 pt-2">
        {down.length > 0 && (
          <button
            onClick={() => dispatch({ type: "toggleAppSettings", open: true })}
            className="mb-1 w-full rounded-lg px-3 py-1.5 text-left text-[12px] text-warning hover:bg-black/4"
          >
            {down.length} engine{down.length === 1 ? "" : "s"} unavailable
          </button>
        )}
        {hiddenBots.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setHiddenOpen((o) => !o)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
            >
              <EyeOff size={20} className="text-ink-secondary" />
              <span className="text-[14px] text-ink">Hidden</span>
              <span className="ml-auto text-[12px] text-ink-secondary">{hiddenBots.length}</span>
            </button>
            {hiddenOpen && (
              <div className="glass mt-1 max-h-48 overflow-y-auto rounded-xl px-2 py-2">
                <div className="mb-1.5 flex items-center gap-2 rounded-full bg-black/4 px-2.5 py-1.5">
                  <Search size={14} className="text-ink-secondary" />
                  <input
                    value={hiddenQuery}
                    onChange={(e) => setHiddenQuery(e.target.value)}
                    placeholder="Search hidden"
                    className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
                  />
                </div>
                {hiddenMatches.length === 0 ? (
                  <div className="px-2 py-1 text-[12px] text-ink-secondary">No matches</div>
                ) : (
                  hiddenMatches.map((b) => (
                    <div key={b.id} className="flex items-center gap-1">
                      <button
                        onClick={() => dispatch({ type: "select", id: b.id })}
                        className="pressable flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/4"
                      >
                        <NexAvatar color={b.color} name={b.name} size={28} />
                        <span className="truncate text-[13px] font-medium text-ink">{b.name}</span>
                      </button>
                      <button
                        onClick={() => dispatch({ type: "updateBot", botId: b.id, patch: { hidden: false } })}
                        className="pressable shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-black/5 hover:text-ink"
                        title="Unhide"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Eye size={14} />
                          Unhide
                        </span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => dispatch({ type: "toggleSkills", open: true })}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
        >
          <BookOpen size={20} className="text-ink-secondary" />
          <span className="text-[14px] text-ink">Skills</span>
        </button>
        <button
          onClick={() => dispatch({ type: "togglePlugins", open: true })}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
        >
          <Puzzle size={20} className="text-ink-secondary" />
          <span className="text-[14px] text-ink">Plugins</span>
        </button>
        <div className="flex items-center">
          <button
            onClick={() => dispatch({ type: "toggleAppSettings" })}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
          >
            <InitialsAvatar initials={profileInitials(state.config?.profile)} size={28} />
            <span className="truncate text-[14px] text-ink">
              {state.config?.profile?.name?.trim() || state.config?.profile?.email?.trim() || "You"}
            </span>
          </button>
          <button
            onClick={() => dispatch({ type: "toggleAppSettings" })}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            title="App settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {menu && <BotContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {meetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/60 backdrop-blur-sm">
          <div className="glass-heavy w-[360px] rounded-2xl p-5">
            <div className="text-[16px] font-semibold text-ink">Meet a teammate</div>
            <p className="mt-1 text-[12.5px] text-ink-secondary">Name the job. Work dies if this PC sleeps.</p>
            <input className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" placeholder="Name" value={meetName} onChange={(e) => setMeetName(e.target.value)} />
            <input className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" placeholder="One job (not General Helper)" value={meetJob} onChange={(e) => setMeetJob(e.target.value)} />
            <input className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" placeholder="How they work" value={meetAbout} onChange={(e) => setMeetAbout(e.target.value)} />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setMeetOpen(false)} className="flex-1 rounded-lg bg-raised py-2 text-[13px] text-ink">Cancel</button>
              <button
                onClick={() => {
                  track("bot_created");
                  dispatch({ type: "newBot", name: meetName || undefined, title: meetJob || undefined, description: meetAbout || undefined });
                  setMeetOpen(false);
                  setMeetName("");
                  setMeetJob("");
                  setMeetAbout("");
                }}
                className="flex-1 rounded-lg bg-ink py-2 text-[13px] text-app"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {teamOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/60 backdrop-blur-sm">
          <div className="glass-heavy w-[360px] rounded-2xl p-5">
            <div className="text-[16px] font-semibold text-ink">Group thread</div>
            <p className="mt-1 text-[12.5px] text-ink-secondary">2 to 6 teammates. Shared transcript.</p>
            <input className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            <div className="mt-2 max-h-48 overflow-y-auto">
              {state.bots.filter((b) => b.kind !== "group" && !b.hidden).map((b) => (
                <label key={b.id} className="flex items-center gap-2 py-1 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={teamPick.includes(b.id)}
                    onChange={() =>
                      setTeamPick((cur) => (cur.includes(b.id) ? cur.filter((id) => id !== b.id) : [...cur, b.id].slice(0, 6)))
                    }
                  />
                  {b.name}
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setTeamOpen(false)} className="flex-1 rounded-lg bg-raised py-2 text-[13px] text-ink">Cancel</button>
              <button
                disabled={teamPick.length < 2}
                onClick={() => {
                  dispatch({ type: "newBot", kind: "group", name: teamName || "Team", memberIds: teamPick });
                  setTeamOpen(false);
                  setTeamPick([]);
                }}
                className="flex-1 rounded-lg bg-ink py-2 text-[13px] text-app disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
