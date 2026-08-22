import { ChevronLeft, FolderOpen, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore, type Bot } from "@/state/store";
import { type Skill } from "./SkillsPanel";
import { NexAvatar } from "./Avatar";
import { LiveScreenPreview, RoutinesCard } from "./ComputerPanel";
import { ChannelsCard } from "./ChannelsCard";
import { NEX_COLORS, NEX_PASTELS, NEX_COLOR_NAMES } from "@/lib/mascot";
import { ModelPicker } from "./ModelPicker";
import { cn } from "@/lib/cn";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] text-ink-secondary">{label}</div>
      {children}
    </label>
  );
}

function GroupMembers({
  bot,
  patch,
}: {
  bot: Bot;
  patch: (p: Partial<Pick<Bot, "memberIds">>) => void;
}) {
  const { state } = useStore();
  const members = bot.memberIds ?? [];
  const addable = state.bots.filter(
    (b) => b.kind !== "group" && !b.hidden && b.id !== bot.id && !members.includes(b.id),
  );
  const setMembers = (next: string[]) => {
    if (next.length < 2 || next.length > 6) return;
    patch({ memberIds: next });
  };
  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Members</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {members.length} of 6 NexBots. Shared transcript.
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {members.map((id) => {
          const m = state.bots.find((b) => b.id === id);
          return (
            <div key={id} className="flex items-center gap-2 rounded-lg bg-inset px-2.5 py-2">
              <NexAvatar color={m?.color ?? bot.color} name={m?.name ?? id} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {m?.name ?? id}
              </span>
              <button
                type="button"
                disabled={members.length <= 2}
                onClick={() => setMembers(members.filter((x) => x !== id))}
                className="pressable shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-black/8 hover:text-danger disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      {members.length < 6 && (
        <div className="mt-3">
          <div className="text-[12px] font-medium text-ink-secondary">Add NexBot</div>
          <div className="mt-1.5 flex flex-col gap-1">
            {addable.length === 0 && (
              <div className="rounded-lg bg-inset px-2.5 py-2 text-[13px] text-ink-secondary">
                No other NexBots to add.
              </div>
            )}
            {addable.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setMembers([...members, b.id])}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-inset"
              >
                <NexAvatar color={b.color} name={b.name} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{b.name}</span>
                <span className="text-[12px] text-ink-secondary">Add</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentSkills({
  bot,
  patch,
}: {
  bot: Bot;
  patch: (p: Partial<Pick<Bot, "enabledSkillSlugs">>) => void;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {});
  }, []);
  const slugs = bot.enabledSkillSlugs;
  const allOn = slugs == null;
  const isOn = (slug: string) => slugs == null || slugs.includes(slug);
  const toggle = (slug: string) => {
    const catalog = skills.map((s) => s.slug);
    if (slugs == null) {
      patch({ enabledSkillSlugs: catalog.filter((s) => s !== slug) });
      return;
    }
    if (slugs.includes(slug)) patch({ enabledSkillSlugs: slugs.filter((s) => s !== slug) });
    else patch({ enabledSkillSlugs: [...slugs, slug] });
  };
  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[15px] font-medium text-ink">Skills</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Which local skills this agent may use. Desk-wide create and delete lives under Team Setup.
          </div>
        </div>
        {!allOn && (
          <button
            onClick={() => patch({ enabledSkillSlugs: null })}
            className="pressable shrink-0 rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-black/8 hover:text-ink"
          >
            Enable all
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {skills.length === 0 && (
          <div className="rounded-lg bg-inset px-3 py-2.5 text-[13px] text-ink-secondary">
            No local skills yet. Add them in Team Setup.
          </div>
        )}
        {skills.map((s) => (
          <div key={s.path} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-ink">{s.name}</div>
              <div className="mt-0.5 truncate text-[12px] text-ink-secondary">{s.description || s.error}</div>
            </div>
            <button
              role="switch"
              aria-checked={isOn(s.slug)}
              onClick={() => toggle(s.slug)}
              className={cn(
                "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                isOn(s.slug) ? "bg-accent" : "bg-raised",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
                  isOn(s.slug) ? "left-[21px]" : "left-[3px]",
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none focus:border-hairline";

const TALKING_STYLE_PRESETS = [
  {
    id: "recommended",
    label: "Recommended default",
    value:
      "Warm, direct, concise, and human. Use plain language and natural contractions. Answer first. Ask one short question when needed.",
  },
  {
    id: "direct",
    label: "Direct and concise",
    value:
      "Clear, calm, and concise. Lead with the result. Use concrete words and short sentences.",
  },
  {
    id: "conversational",
    label: "Warm and conversational",
    value:
      "Friendly, natural, and easy to talk to. Use contractions, explain unfamiliar terms, and keep the conversation moving.",
  },
] as const;

export function SettingsPanel({
  bot,
  initialPage = "overview",
}: {
  bot: Bot;
  initialPage?: "overview" | "identity";
}) {
  const { dispatch } = useStore();
  const patch = (
    p: Partial<
      Pick<Bot, "name" | "title" | "description" | "personality" | "notifications" | "computer" | "color" | "mascotExpression" | "memoryEnabled" | "enabledSkillSlugs" | "memberIds" | "proactiveEnabled" | "completionPings" | "permissionMode" | "allowCriticalActions">
    >,
  ) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const [profile, setProfile] = useState("");
  const [log, setLog] = useState("");
  const [desk, setDesk] = useState("");
  const [page, setPage] = useState<"overview" | "identity">(initialPage);
  const selectedTalkingStylePreset = TALKING_STYLE_PRESETS.find((preset) => preset.value === bot.personality)?.id ?? (bot.personality ? "custom" : "");
  const saveMemory = (patch: { enabled?: boolean; profile?: string; log?: string }) => {
    void fetch(`/api/bots/${bot.id}/memory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: patch.enabled ?? bot.memoryEnabled,
        profile: patch.profile ?? profile,
        log: patch.log ?? log,
      }),
    });
  };
  useEffect(() => {
    setPage(initialPage);
  }, [bot.id, initialPage]);
  useEffect(() => {
    fetch(`/api/bots/${bot.id}/memory`)
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.profile ?? d.text ?? "");
        setLog(d.log ?? "");
      })
      .catch(() => {});
    fetch(`/api/bots/${bot.id}/desk`)
      .then((r) => r.json())
      .then((d) => setDesk(d.path ?? ""))
      .catch(() => {});
  }, [bot.id]);

  return (
    <aside className="glass-heavy animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-black/10">
      <div className="flex items-center justify-between px-4 py-3">
        {page === "identity" ? (
          <button
            type="button"
            onClick={() => setPage("overview")}
            className="pressable rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
            aria-label="Back to agent settings"
          >
            <ChevronLeft size={18} />
          </button>
        ) : (
          <span className="w-7" />
        )}
        <span className="text-[15px] font-semibold text-ink">{page === "identity" ? "Agent" : bot.name}</span>
        <div className="flex items-center gap-0.5">
          {page === "overview" && (
            <button
              type="button"
              onClick={() => setPage("identity")}
              className="pressable rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
              title="Name, title, memory"
            >
              <Settings size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleSettings", open: false })}
            className="pressable rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
            aria-label="Close agent settings"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {page === "overview" && (
          <div className="flex flex-col gap-3 pt-2">
            <LiveScreenPreview
              bot={bot}
              onOpen={() => dispatch({ type: "toggleComputer", open: true })}
            />
            <RoutinesCard bot={bot} />
            <ChannelsCard />
            {bot.kind === "group" && <GroupMembers bot={bot} patch={patch} />}
          </div>
        )}
        {page === "identity" && (
        <div>
        <div className="flex justify-center py-5">
          <NexAvatar color={bot.color} name={bot.name} size={88} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-black/10 bg-black/4">
            <div className="flex items-center justify-between border-b border-black/10 px-3 py-2.5">
              <span className="text-[14px] font-medium text-ink">Bot color</span>
              <button
                onClick={() => patch({ color: "green", mascotExpression: null })}
                className="pressable rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-black/8 hover:text-ink"
              >
                Reset
              </button>
            </div>

            <div className="p-3">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                Pastel background
              </div>
              <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
                {NEX_COLOR_NAMES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => patch({ color })}
                    className={cn(
                      "pressable flex min-h-11 min-w-0 w-full items-center justify-center rounded-full border border-transparent",
                      bot.color === color && "ring-2 ring-accent-border ring-offset-2 ring-offset-panel",
                    )}
                    title={color}
                    aria-label={`Use ${color} pastel background`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-8 rounded-full border border-black/15"
                      style={{
                        backgroundColor: NEX_PASTELS[color],
                        boxShadow: `inset 0 0 0 2px ${NEX_COLORS[color]}55`,
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Field label="Name">
            <input
              className={inputCls}
              value={bot.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Title">
            <input
              className={inputCls}
              placeholder="Describe what your agent does"
              value={bot.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              className={cn(inputCls, "min-h-[96px] resize-none")}
              placeholder="What this agent is for"
              value={bot.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
          <Field label="Talking style">
            <select
              value={selectedTalkingStylePreset}
              onChange={(e) => {
                const preset = TALKING_STYLE_PRESETS.find((option) => option.id === e.target.value);
                patch({ personality: preset?.value ?? "" });
              }}
              className={cn(inputCls, "mb-2")}
              aria-label="Talking style preset"
            >
              <option value="">Choose a talking style…</option>
              {TALKING_STYLE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
              {selectedTalkingStylePreset === "custom" && <option value="custom">Custom</option>}
            </select>
            <textarea
              className={cn(inputCls, "min-h-[112px] resize-y")}
              placeholder="Choose a talking style or write your own. Leave blank for work-focused specialists."
              value={bot.personality ?? ""}
              onChange={(e) => patch({ personality: e.target.value })}
            />
            <div className="mt-1.5 text-[12px] leading-relaxed text-ink-secondary">
              Optional voice guidance. Leave this blank when the bot should focus on role and skills.
            </div>
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">Model</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                Which provider and model this bot runs on
              </div>
            </div>
            <ModelPicker bot={bot} />
          </div>

          <div className="rounded-xl bg-card p-4">
            <div className="text-[15px] font-medium text-ink">Computer</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              This PC via CUA. There is no cloud desktop.
            </div>
            <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
              {(["local", "off"] as const).map((mode, i) => (
                <button
                  key={mode}
                  onClick={() => patch({ computer: mode })}
                  className={cn(
                    "flex-1 py-1.5 text-[13px] capitalize",
                    i > 0 && "border-l border-hairline/40",
                    (bot.computer === mode || (mode === "local" && bot.computer !== "off"))
                      ? "bg-raised text-ink"
                      : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                  )}
                >
                  {mode === "local" ? "This PC" : mode}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[15px] font-medium text-ink">Memory</div>
                <div className="mt-0.5 text-[13px] text-ink-secondary">
                  Facts injected each turn. Profile and this month’s log live on disk.
                </div>
              </div>
              <button
                role="switch"
                aria-checked={!!bot.memoryEnabled}
                onClick={() => {
                  const enabled = !bot.memoryEnabled;
                  patch({ memoryEnabled: enabled });
                  saveMemory({ enabled });
                }}
                className={cn(
                  "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                  bot.memoryEnabled ? "bg-accent" : "bg-raised",
                )}
              >
                <span
                  className={cn(
                    "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
                    bot.memoryEnabled ? "left-[21px]" : "left-[3px]",
                  )}
                />
              </button>
            </div>
            <div className="mt-3 text-[12px] font-medium text-ink-secondary">Profile</div>
            <textarea
              className={cn(inputCls, "mt-1.5 min-h-[88px] resize-none")}
              placeholder="Durable facts. Owner: Charles. Prefer short answers."
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              onBlur={() => saveMemory({ profile })}
            />
            <div className="mt-3 text-[12px] font-medium text-ink-secondary">This month</div>
            <textarea
              className={cn(inputCls, "mt-1.5 min-h-[88px] resize-none")}
              placeholder="Dated notes for this month."
              value={log}
              onChange={(e) => setLog(e.target.value)}
              onBlur={() => saveMemory({ log })}
            />
            {desk && (
              <button
                onClick={() => window.nexbot?.openPath?.(desk)}
                className="pressable mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-secondary hover:text-ink"
              >
                <FolderOpen size={13} />
                Open desk folder
              </button>
            )}
          </div>

          {bot.kind !== "group" && (
            <div className="rounded-xl bg-card p-4">
              <div className="text-[15px] font-medium text-ink">Access</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                Like a CLI permission flag — what this NexBot may do without asking.
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {([
                  ["readonly", "Read only"],
                  ["workspace", "Workspace write"],
                  ["full", "Full access"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => patch({ permissionMode: value })}
                    className={cn(
                      "pressable rounded-md border px-2 py-1.5 text-[12px] font-medium",
                      (bot.permissionMode ?? "workspace") === value
                        ? "border-accent/40 bg-accent/10 text-ink"
                        : "border-hairline/30 text-ink-secondary hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(bot.permissionMode ?? "workspace") === "full" && (
                <div className="mt-3 flex items-center justify-between gap-4 border-t border-hairline/30 pt-3">
                  <div>
                    <div className="text-[13px] font-medium text-ink">Also allow critical actions</div>
                    <div className="mt-0.5 text-[12px] text-ink-secondary">
                      True bypass — money, credentials, publishing, external sends too. Off keeps those behind an approval.
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={bot.allowCriticalActions === true}
                    onClick={() => patch({ allowCriticalActions: bot.allowCriticalActions !== true })}
                    className={cn(
                      "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                      bot.allowCriticalActions === true ? "bg-accent" : "bg-raised",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
                        bot.allowCriticalActions === true ? "left-[21px]" : "left-[3px]",
                      )}
                    />
                  </button>
                </div>
              )}
            </div>
          )}

          <AgentSkills bot={bot} patch={patch} />

          {bot.kind !== "group" && (
            <div className="rounded-xl bg-card p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[15px] font-medium text-ink">Proactive work</div>
                  <div className="mt-0.5 text-[13px] text-ink-secondary">
                    {bot.name.toLowerCase() === "luna" || bot.title.toLowerCase().includes("chief of staff")
                      ? "Luna takes the lead when tasks change and sends completion reports."
                      : "This NexBot acts when a task changes or needs follow-up."}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={bot.proactiveEnabled !== false}
                  onClick={() => patch({ proactiveEnabled: bot.proactiveEnabled === false })}
                  className={cn(
                    "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                    bot.proactiveEnabled !== false ? "bg-accent" : "bg-raised",
                  )}
                >
                  <span
                    className={cn(
                    "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
                      bot.proactiveEnabled !== false ? "left-[21px]" : "left-[3px]",
                    )}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-4 border-t border-hairline/30 pt-3">
                <div>
                  <div className="text-[13px] font-medium text-ink">Report completed tasks to CoS</div>
                  <div className="mt-0.5 text-[12px] text-ink-secondary">Luna receives a concise result or blocker.</div>
                </div>
                <button
                  role="switch"
                  aria-checked={bot.completionPings !== false}
                  onClick={() => patch({ completionPings: bot.completionPings === false })}
                  className={cn(
                    "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                    bot.completionPings !== false ? "bg-accent" : "bg-raised",
                  )}
                >
                  <span
                    className={cn(
                    "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
                      bot.completionPings !== false ? "left-[21px]" : "left-[3px]",
                    )}
                  />
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
            <div>
              <div className="text-[15px] font-medium text-ink">
                Notifications
              </div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                Get notified when this agent finishes or needs input
              </div>
            </div>
            <button
              role="switch"
              aria-checked={bot.notifications}
              onClick={() => patch({ notifications: !bot.notifications })}
              className={cn(
                "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
                bot.notifications ? "bg-accent" : "bg-raised",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
                  bot.notifications ? "left-[21px]" : "left-[3px]",
                )}
              />
            </button>
          </div>
        </div>
        </div>
        )}
      </div>
    </aside>
  );
}
