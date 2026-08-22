import { track } from "@/lib/analytics";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BellDot,
  ClipboardCopy,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Settings,
  Puzzle,
  Trash2,
  Users,
  BookOpen,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { NexAvatar, InitialsAvatar } from "./Avatar";
import { NexMark } from "./NexMark";
import { cn } from "@/lib/cn";
import { pickerInstances } from "@/lib/provider-visibility";
import { stripWorkingNarration } from "@/lib/activity";
import { NEXBOT_TEMPLATES, nexBotCopy } from "@/lib/nexbot-templates";
import { NEX_COLORS, NEX_COLOR_NAMES, NEX_PASTELS, type NexColor } from "@/lib/mascot";

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
  for (const message of [...bot.messages].reverse()) {
    if (message.kind === "options" && message.card) return nexBotCopy(message.card.title);
    if (message.kind === "activity" && message.tool) return message.tool.name;
    if (message.kind === "screen") return "Screen frame";
    const clean = stripWorkingNarration(message.text ?? "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, "$1")
      .replace(/[*_`>#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:Answer|Status|Owner|Need from you):\s*/i, "");
    if (clean) return clean.slice(0, 140);
  }
  return "";
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
        item(<BellDot size={16} className="text-ink-secondary" />, "Mark as Unread", () =>
          dispatch({ type: "markUnread", botId: bot.id }),
        ),
        divider("d1"),
        item(<Pencil size={16} className="text-ink-secondary" />, "Edit Profile", () => {
          dispatch({ type: "select", id: bot.id });
          dispatch({ type: "toggleSettings", open: true, page: "identity" });
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
        Approval required: {nexBotCopy(pendingCard.card.title)}
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
  onMenu,
  draggingId,
  dropTargetId,
  onDragBegin,
  onDragTarget,
  onReorder,
  onDragFinish,
}: {
  bot: Bot;
  onMenu: (menu: MenuState) => void;
  draggingId: string | null;
  dropTargetId: string | null;
  onDragBegin: (botId: string) => void;
  onDragTarget: (botId: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onDragFinish: () => void;
}) {
  const { state, dispatch } = useStore();
  const selected = state.selectedId === bot.id;
  const isChief = isChiefOfStaffBot(bot);
  const mascot = state.mascotMotion?.botId === bot.id ? state.mascotMotion : undefined;
  const surface = NEX_PASTELS[bot.color] ?? NEX_PASTELS.green;
  return (
    <div
      draggable={!isChief}
      onDragStart={(e) => {
        if (isChief) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", bot.id);
        onDragBegin(bot.id);
      }}
      onDragEnter={(e) => {
        if (!isChief && draggingId && draggingId !== bot.id) {
          e.preventDefault();
          onDragTarget(bot.id);
        }
      }}
      onDragOver={(e) => {
        if (!isChief && draggingId && draggingId !== bot.id) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer.getData("text/plain");
        if (!isChief && sourceId && sourceId !== bot.id) onReorder(sourceId, bot.id);
        onDragFinish();
      }}
      onDragEnd={onDragFinish}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
      }}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-xl border px-2 py-2 transition-[background-color,border-color,box-shadow] duration-150",
        selected
          ? "border-black/10 shadow-sm font-semibold"
          : "border-transparent hover:bg-black/4",
        draggingId === bot.id && "opacity-45",
        dropTargetId === bot.id && "border-accent/50 ring-2 ring-accent/20",
      )}
      aria-label={isChief ? `${bot.name}. Chief of Staff. Always at the top.` : `${bot.name}. Drag to reorder.`}
      style={{
        background: selected
          ? `linear-gradient(110deg, ${surface}c2, ${surface}55 62%, transparent 100%)`
          : `linear-gradient(110deg, ${surface}4a, transparent 72%)`,
      }}
    >
      <button
        type="button"
        onClick={() => dispatch({ type: "select", id: bot.id })}
        className="pressable flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left"
        aria-label={isChief ? `${bot.name}. Chief of Staff.` : `${bot.name}. Drag to reorder.`}
      >
        <div className="relative">
          <NexAvatar
            color={bot.color}
            name={bot.name}
            size={38}
            motion={mascot?.kind ?? (bot.busy ? "thinking" : undefined)}
            motionKey={mascot?.nonce}
          />
          {bot.busy && (
            <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500 animate-pulse" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink">{bot.name}</div>
          <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
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

      <div className="flex shrink-0 items-center gap-0.5">
        {!isChief && (
          <GripVertical
            size={16}
            className="cursor-grab text-ink-secondary/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: "select", id: bot.id });
            dispatch({ type: "toggleSettings", open: true, page: "identity" });
          }}
          className="pressable flex size-8 items-center justify-center rounded-md text-ink-secondary opacity-0 transition-opacity duration-150 hover:bg-black/6 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          title={`Edit ${bot.name} settings`}
          aria-label={`Edit ${bot.name} settings`}
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ open = true }: { open?: boolean }) {
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
  const [meetTemplateId, setMeetTemplateId] = useState<string | null>(null);
  const [meetHoverTemplateId, setMeetHoverTemplateId] = useState<string | null>(null);
  const [meetColor, setMeetColor] = useState<NexColor>("green");
  const [meetInstanceId, setMeetInstanceId] = useState("");
  const [meetModel, setMeetModel] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("Team");
  const [teamPick, setTeamPick] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const visibleBots = state.bots
    .filter((b) => !b.hidden || isChiefOfStaffBot(b))
    .filter((b) => matchesQuery(b, q))
    .sort((a, b) => {
      const aChief = isChiefOfStaffBot(a);
      const bChief = isChiefOfStaffBot(b);
      if (aChief !== bChief) return aChief ? -1 : 1;
      const aOrder = a.sortOrder ?? state.bots.indexOf(a);
      const bOrder = b.sortOrder ?? state.bots.indexOf(b);
      return aOrder - bOrder;
    });
  const chiefOfStaff = visibleBots.find(isChiefOfStaffBot);

  const reorderBots = (sourceId: string, targetId: string) => {
    const specialists = state.bots
      .filter((b) => (!b.hidden || isChiefOfStaffBot(b)) && !isChiefOfStaffBot(b))
      .sort((a, b) => (a.sortOrder ?? state.bots.indexOf(a)) - (b.sortOrder ?? state.bots.indexOf(b)));
    const sourceIndex = specialists.findIndex((b) => b.id === sourceId);
    const targetIndex = specialists.findIndex((b) => b.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...specialists];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved!);
    next.forEach((bot, index) => {
      if (bot.sortOrder !== index) {
        dispatch({ type: "updateBot", botId: bot.id, patch: { sortOrder: index } });
      }
    });
  };

  const hq = hiddenQuery.trim().toLowerCase();
  const hiddenBots = state.bots.filter((b) => b.hidden && !isChiefOfStaffBot(b));
  const hiddenMatches = hiddenBots.filter((b) => {
    if (!hq) return true;
    return b.name.trim().toLowerCase().includes(hq);
  });

  const visibleInstances = pickerInstances(state.instances);
  const availableMeetInstances = visibleInstances.filter((i) => i.snapshot.state === "available");
  const meetInstance =
    availableMeetInstances.find((i) => i.instanceId === meetInstanceId) ?? availableMeetInstances[0];
  const meetModelOption =
    meetInstance?.models.options.find((option) => option.id === meetModel) ??
    meetInstance?.models.options.find((option) => option.id === meetInstance.models.default) ??
    meetInstance?.models.options[0];
  const meetTemplate = NEXBOT_TEMPLATES.find((template) => template.id === meetTemplateId);
  const meetPreviewTemplate = NEXBOT_TEMPLATES.find((template) => template.id === meetHoverTemplateId) ?? meetTemplate;
  const meetPreviewIndex = meetPreviewTemplate
    ? NEXBOT_TEMPLATES.findIndex((template) => template.id === meetPreviewTemplate.id)
    : -1;
  return (
    <aside className={cn(
      "glass-heavy flex h-full w-[300px] shrink-0 flex-col border-r border-black/8",
      !open && "hidden",
      "max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:left-0 max-[900px]:z-40 mobile-sidebar-surface",
    )}>
      {/* Titlebar: real traffic lights in Electron, faux ones in the browser */}
      <div
        className="flex items-center justify-between px-4 pt-3.5 pb-1"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 text-ink">
          {isElectron && <div className="w-14" />}
          <NexMark className="size-5" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-medium tracking-tight">
              {state.config?.profile?.companyName?.trim() || "NexBot"}
            </div>
            <div className="truncate text-[10px] text-ink-secondary">Powered by NexBots</div>
          </div>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={() => setTeamOpen(true)}
            className="pressable flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-secondary hover:bg-black/5 hover:text-ink"
            title="New NexBot group"
            aria-label="New NexBot group"
          >
            <Users size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => setMeetOpen(true)}
            className="group relative pressable flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-secondary hover:bg-black/5 hover:text-ink"
            title="Add NexBot"
            aria-label="Add NexBot"
          >
            <Plus size={18} strokeWidth={2} />
            <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-app opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
              Add NexBot
            </span>
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
        <div className="flex flex-col gap-0.5">
          {visibleBots.map((b) => (
            <BotListItem
              key={b.id}
              bot={b}
              onMenu={setMenu}
              draggingId={draggingId}
              dropTargetId={dropTargetId}
              onDragBegin={setDraggingId}
              onDragTarget={setDropTargetId}
              onReorder={reorderBots}
              onDragFinish={() => {
                setDraggingId(null);
                setDropTargetId(null);
              }}
            />
          ))}
        </div>
      </div>

      {q && visibleBots.length === 0 && (
        <div className="px-4 pb-2 text-[12px] text-ink-secondary">No matches</div>
      )}

      {/* Footer */}
      <div className="px-3 pb-3 pt-2">
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
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink"
            title="App settings"
            aria-label="App settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {menu && <BotContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {meetOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-md">
          <div className="glass-heavy max-h-[calc(100dvh-32px)] w-[min(760px,calc(100vw-32px))] overflow-y-auto rounded-[24px] p-5 shadow-2xl shadow-black/15 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[17px] font-semibold text-ink">Add a NexBot</div>
                <p className="mt-1 text-[12.5px] text-ink-secondary">Choose a ready-made role or shape your own NexBot.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-medium text-ink-secondary">7 roles</span>
                <button
                  type="button"
                  onClick={() => {
                    setMeetOpen(false);
                    setMeetHoverTemplateId(null);
                  }}
                  className="pressable flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-secondary hover:bg-black/6 hover:text-ink"
                  aria-label="Close add NexBot"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">Your core NexBot</div>
                <span className="text-[11px] text-ink-secondary">One per workspace</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-ink/15 bg-ink/5 px-3 py-3">
                <NexAvatar color={chiefOfStaff?.color ?? "purple"} name={chiefOfStaff?.name ?? "Chief of Staff"} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">Chief of Staff</div>
                  <div className="truncate text-[11px] text-ink-secondary">{chiefOfStaff?.name ?? "Set up during onboarding"}</div>
                </div>
                <span className="shrink-0 rounded-full bg-ink/10 px-2 py-1 text-[10px] font-semibold text-ink-secondary">
                  {chiefOfStaff ? "Already set up" : "Onboarding"}
                </span>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">NexBot library</div>
              <span className="text-[11px] text-ink-secondary">6 specialist roles</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {NEXBOT_TEMPLATES.map((template) => {
                const active = meetPreviewTemplate?.id === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={meetTemplateId === template.id}
                    aria-label={`${template.name}: ${template.title}. ${template.description}`}
                    onMouseEnter={() => setMeetHoverTemplateId(template.id)}
                    onMouseLeave={() => setMeetHoverTemplateId(null)}
                    onFocus={() => setMeetHoverTemplateId(template.id)}
                    onBlur={() => setMeetHoverTemplateId(null)}
                    onClick={() => {
                      setMeetTemplateId(template.id);
                      setMeetColor(template.color);
                      setMeetName(template.name);
                      setMeetJob(template.title);
                      setMeetAbout(template.description);
                    }}
                    className={cn(
                      "pressable group relative flex aspect-square w-full items-center justify-center rounded-2xl border transition-[background-color,border-color,box-shadow] duration-150",
                      active ? "border-ink/35 shadow-sm" : "border-black/8 hover:border-black/18",
                    )}
                    style={{
                      background: active
                        ? `linear-gradient(180deg, ${NEX_PASTELS[template.color]}d9, ${NEX_PASTELS[template.color]}8c)`
                        : `linear-gradient(180deg, ${NEX_PASTELS[template.color]}72, ${NEX_PASTELS[template.color]}38)`,
                    }}
                  >
                    <NexAvatar color={template.color} name={template.name} size={48} />
                    {meetTemplateId === template.id && (
                      <span className="absolute right-2 top-2 size-2 rounded-full bg-ink" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
            {meetPreviewTemplate ? (
              <div className="relative mt-2.5">
                <span
                  aria-hidden="true"
                  className="absolute -top-2 left-0 hidden h-2 w-px bg-ink/25 sm:block"
                  style={{ left: `${((meetPreviewIndex + 0.5) / 6) * 100}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute -top-2 left-0 h-2 w-px bg-ink/25 sm:hidden"
                  style={{ left: `${(((meetPreviewIndex % 3) + 0.5) / 3) * 100}%` }}
                />
                <div className="flex items-center gap-3 rounded-2xl border border-ink/15 bg-black/4 px-3.5 py-3">
                  <NexAvatar color={meetPreviewTemplate.color} name={meetPreviewTemplate.name} size={34} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-semibold text-ink">{meetPreviewTemplate.name}</span>
                      <span className="text-[11px] font-medium text-ink-secondary">{meetPreviewTemplate.title}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-[1.35] text-ink-secondary">{meetPreviewTemplate.description}</p>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-ink-secondary">Customize</div>
            <input className="mt-1.5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" placeholder="NexBot name" value={meetName} onChange={(e) => setMeetName(e.target.value)} />
            <input className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" placeholder="One job" value={meetJob} onChange={(e) => setMeetJob(e.target.value)} />
            <input className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink" placeholder="How it works" value={meetAbout} onChange={(e) => setMeetAbout(e.target.value)} />
            <div className="mt-3 rounded-xl border border-black/8 bg-black/3 px-3 py-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">Pastel background</div>
              <div className="mt-2 grid grid-cols-5 gap-1 sm:grid-cols-10" role="group" aria-label="Choose bot background color">
                {NEX_COLOR_NAMES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setMeetColor(color)}
                    className={cn(
                      "pressable flex min-h-11 min-w-0 w-full items-center justify-center rounded-full border border-transparent",
                      meetColor === color && "ring-2 ring-accent-border ring-offset-2 ring-offset-panel",
                    )}
                    title={color}
                    aria-label={`Use ${color} pastel background`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-7 rounded-full border border-black/15"
                      style={{
                        backgroundColor: NEX_PASTELS[color],
                        boxShadow: `inset 0 0 0 2px ${NEX_COLORS[color]}55`,
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
              Provider / CLI
              <select
                value={meetInstance?.instanceId ?? ""}
                onChange={(e) => {
                  const next = state.instances.find((instance) => instance.instanceId === e.target.value);
                  setMeetInstanceId(next?.instanceId ?? "");
                  setMeetModel(next?.models.default ?? next?.models.options[0]?.id ?? "");
                }}
                className="mt-1.5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] font-normal normal-case tracking-normal text-ink"
              >
                {state.instances.length === 0 && <option value="">Loading providers…</option>}
                {visibleInstances.map((instance) => (
                  <option key={instance.instanceId} value={instance.instanceId} disabled={instance.snapshot.state !== "available"}>
                    {instance.displayName} · {instance.driverKind}
                    {instance.snapshot.state !== "available" ? " — optional" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
              Model
              <select
                value={meetModelOption?.id ?? ""}
                onChange={(e) => setMeetModel(e.target.value)}
                disabled={!meetInstance || meetInstance.models.options.length === 0}
                className="mt-1.5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] font-normal normal-case tracking-normal text-ink disabled:opacity-50"
              >
                {meetInstance?.models.options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
                {!meetInstance && <option value="">No available models</option>}
              </select>
            </label>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setMeetOpen(false);
                  setMeetHoverTemplateId(null);
                }}
                className="flex-1 rounded-lg bg-raised py-2 text-[13px] text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  track("bot_created");
                  dispatch({
                    type: "newBot",
                    name: meetName || undefined,
                    title: meetJob || undefined,
                    description: meetAbout || undefined,
                    color: meetColor,
                    modelSelection: meetInstance && meetModelOption
                      ? { instanceId: meetInstance.instanceId, model: meetModelOption.id }
                      : undefined,
                  });
                  setMeetOpen(false);
                  setMeetName("");
                  setMeetJob("");
                  setMeetAbout("");
                  setMeetTemplateId(null);
                  setMeetHoverTemplateId(null);
                  setMeetColor("green");
                  setMeetInstanceId("");
                  setMeetModel("");
                }}
                className="flex-1 rounded-lg bg-ink py-2 text-[13px] text-app"
              >
                Add NexBot
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {teamOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-md">
          <div className="glass-heavy w-[360px] rounded-2xl p-5">
            <div className="text-[16px] font-semibold text-ink">NexBot group</div>
            <p className="mt-1 text-[12.5px] text-ink-secondary">2 to 6 NexBots. Shared transcript.</p>
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
        </div>,
        document.body,
      )}
    </aside>
  );
}
