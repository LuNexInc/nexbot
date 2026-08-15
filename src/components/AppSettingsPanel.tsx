// App-level settings: profile, connection keys, agent CLI status,
// desktop permissions, About. No third-party product analytics.
import { Check, ExternalLink, Loader2, Mic, Monitor, Plus, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useStore, type Bot, type InstanceInfo } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { ConnectorsBody } from "./PluginsPanel";
import { SkillsBody } from "./SkillsPanel";
import { NexAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { ExpertToggle } from "./ExpertToggle";
import { ThemeToggle } from "./ThemeToggle";

const APP_VERSION = "0.3.9";

/** Profile and workspace brand, persisted to /api/config {profile} on blur. */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [companyName, setCompanyName] = useState(state.config?.profile?.companyName ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setCompanyName(state.config?.profile?.companyName ?? "");
    setEmail(state.config?.profile?.email ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.companyName, state.config?.profile?.email]);

  const save = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: {
          name: name.trim(),
          companyName: companyName.trim(),
          email: email.trim().toLowerCase(),
        },
      }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[12px] text-ink-secondary">Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          placeholder="Your name"
          className={inputClass}
        />
      </div>
      <div>
        <div className="mb-1 text-[12px] text-ink-secondary">Company name</div>
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onBlur={save}
          placeholder="LuNex Inc"
          className={inputClass}
        />
      </div>
      <div>
        <div className="mb-1 text-[12px] text-ink-secondary">Email</div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={save}
          placeholder="you@example.com"
          className={inputClass}
        />
      </div>
    </div>
  );
}

function ExpertModeSection() {
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-ink">Expert mode</div>
          <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
            Show reasoning, tool activity, steps, teammate handoffs, and performance details in chat.
            Turn it off for answer-first conversations.
          </div>
        </div>
        <ExpertToggle className="shrink-0" />
      </div>
    </div>
  );
}

function ProvidersSection() {
  const { state, dispatch } = useStore();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetch("/api/instances")
      .then((r) => r.json())
      .then((d) => dispatch({ type: "instances", instances: d.instances ?? [] }))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [dispatch]);

  useEffect(() => {
    if (!state.instances.length) refresh();
  }, [state.instances.length, refresh]);

  const rows: InstanceInfo[] = state.instances;

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium text-ink">Agent CLIs</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Local tools NexBot can drive. Install and log in outside this app (claude / codex / grok).
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="text-[13px] text-ink-secondary">
            {state.connected ? "No providers registered yet." : "Connect to the bot server to list CLIs."}
          </div>
        )}
        {rows.map((row) => {
          const ok = row.snapshot.state === "available";
          return (
            <div
              key={row.instanceId}
              className="flex items-start gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2.5"
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  ok ? "bg-success" : "bg-raised-hover",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-ink">
                  {row.displayName || row.instanceId}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-secondary">
                  {ok
                    ? [
                        row.snapshot.version && `v${row.snapshot.version}`,
                        row.snapshot.authenticated === false && "not signed in",
                        row.snapshot.authenticated === true && "signed in",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Available"
                    : row.snapshot.reason
                      ? `Optional · ${row.snapshot.reason}`
                      : "Optional · not configured"}
                </div>
              </div>
              {ok ? (
                <Check size={14} className="mt-1 shrink-0 text-success" />
              ) : (
                <span className="mt-0.5 text-[11px] text-ink-secondary">optional</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComputerUseSection() {
  const isDesktop = Boolean(window.nexbot);
  const [mode, setMode] = useState<string>("…");
  const [binary, setBinary] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!window.nexbot?.cuaConnection) return;
    void window.nexbot.cuaConnection().then((c) => {
      setMode(c?.mode ?? "unavailable");
      setReason(c?.reason ?? null);
      setHint(c?.installHint ?? null);
      setBinary(typeof c?.binary === "string" ? c.binary : null);
    });
    void window.nexbot.cuaBinary?.().then((b) => {
      if (b) setBinary(b);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isDesktop) {
    return (
      <div className="mt-4 rounded-xl bg-card p-4">
        <div className="text-[15px] font-medium text-ink">Computer use (CUA)</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">
          Local desktop control needs the Electron app.
        </div>
      </div>
    );
  }

  const ok = mode === "embedded" || mode === "standalone" || mode === "external";

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium text-ink">Computer use (CUA)</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            trycua driver — bots click, type, and read this PC when computer mode is This PC.
          </div>
        </div>
        <button
          onClick={refresh}
          className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="mt-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2.5">
        <div className="flex items-center gap-2 text-[14px] text-ink">
          <span className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-raised-hover")} />
          Mode: <span className="font-medium">{mode}</span>
        </div>
        {binary && (
          <code className="mt-2 block break-all text-[11px] text-ink-secondary">{binary}</code>
        )}
        {reason && <div className="mt-2 text-[12px] text-ink-secondary">{reason}</div>}
        {hint && (
          <code className="mt-2 block rounded bg-raised px-2 py-1.5 text-[11px] text-ink">{hint}</code>
        )}
      </div>
    </div>
  );
}

function DesktopPermissions() {
  const isDesktop = Boolean(window.nexbot);
  const [mic, setMic] = useState<string>("unknown");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!window.nexbot?.permStatus) return;
    void window.nexbot.permStatus().then((s) => setMic(s.mic ?? "unknown"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isDesktop) {
    return (
      <div className="mt-4 rounded-xl bg-card p-4">
        <div className="text-[15px] font-medium text-ink">Desktop permissions</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">
          Open the desktop app for microphone, speech, and screen capture controls.
        </div>
      </div>
    );
  }

  const micOk = mic === "granted";

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Desktop permissions</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Used for voice dictation and optional local screen preview.
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Mic size={16} className="text-ink-secondary" />
            <div>
              <div className="text-[14px] text-ink">Microphone / speech</div>
              <div className="text-[12px] text-ink-secondary">{mic}</div>
            </div>
          </div>
          <button
            disabled={busy || micOk}
            onClick={() => {
              setBusy(true);
              void window.nexbot
                ?.permRequestMic?.()
                .then(() => refresh())
                .finally(() => setBusy(false));
            }}
            className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : micOk ? "Granted" : "Enable"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Monitor size={16} className="text-ink-secondary" />
            <div>
              <div className="text-[14px] text-ink">Screen capture</div>
              <div className="text-[12px] text-ink-secondary">
                Prompted when a bot previews this PC
              </div>
            </div>
          </div>
          <button
            onClick={() => void window.nexbot?.permOpenSettings?.("screen")}
            className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
          >
            OS settings
          </button>
        </div>
        {!micOk && (
          <button
            onClick={() => void window.nexbot?.permOpenSettings?.("mic")}
            className="text-left text-[12px] text-accent hover:underline"
          >
            Open OS privacy settings for microphone
          </button>
        )}
      </div>
    </div>
  );
}

function SteerSection() {
  const [token, setToken] = useState("");
  const [path, setPath] = useState("");
  const load = () => {
    fetch("/api/steer")
      .then((r) => r.json())
      .then((d) => {
        setToken(d.token ?? "");
        setPath(d.path ?? "");
      })
      .catch(() => {});
  };
  useEffect(load, []);
  const href = path ? `${location.protocol}//${location.hostname}:8799${path}` : "";
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Phone and chat</div>
      <div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
        Signed link for /m.html (token lives in the URL hash, not the query string). Discord or
        Telegram can POST /api/steer/jobs with this Bearer token. This PC must stay on. Default
        bind is 127.0.0.1. Set NEXBOT_BIND=0.0.0.0 only for LAN — non-local /api calls then need
        this steer token (phone) or the harness token in ~/.nexbot/harness.json.
      </div>
      <code className="mt-3 block break-all rounded-lg bg-inset px-2.5 py-2 text-[11px] text-ink">
        {href || "…"}
      </code>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => href && navigator.clipboard.writeText(href)}
          className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
        >
          Copy link
        </button>
        <button
          onClick={() =>
            fetch("/api/steer/rotate", { method: "POST" })
              .then((r) => r.json())
              .then(() => load())
          }
          className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
        >
          Rotate token
        </button>
      </div>
      {token && (
        <div className="mt-2 text-[11px] text-ink-secondary">Token length {token.length}. Not written to git.</div>
      )}
    </div>
  );
}

function AboutSection() {
  const { state } = useStore();
  const dataDir = state.config?.dataDir || "~/.nexbot";
  const version = state.config?.version || APP_VERSION;
  const platform = state.config?.platform || window.nexbot?.platform || "browser";

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">About</div>
      <div className="mt-3 space-y-2 text-[13px] text-ink-secondary">
        <div className="flex justify-between gap-3">
          <span>NexBot</span>
          <span className="text-ink">v{version}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Platform</span>
          <span className="text-ink">{platform}</span>
        </div>
        <div>
          <div className="mb-1">Data directory</div>
          <code className="block break-all rounded-lg bg-inset px-2.5 py-2 text-[12px] text-ink">
            {dataDir}
          </code>
        </div>
        <div className="pt-1 text-[12px] leading-relaxed">
          No product analytics are shipped.
          Phone assign needs the signed <code className="text-ink">/m.html#token=…</code> link
          in Phone &amp; chat. Event logs rotate at 5 MB and drop after 14 days.
          Set <code className="text-ink">NEXBOT_NATIVE_LOG=0</code> to stop the protocol tee.
          Closing the window keeps the tray. Quit stops work. Enable
          &ldquo;Keep this PC as the host&rdquo; so a reboot starts NexBot again.
        </div>
        <a
          href="https://github.com/LuNexInc/nexbot"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
        >
          Source on GitHub <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

function WipeSection() {
  const { dispatch, state } = useStore();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = state.config?.wipeConfigured === true;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setPassword("");
    setConfirmation("");
    setError(null);
    setMessage(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/wipe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nexbot-wipe-password": password,
        },
        body: JSON.stringify({ confirmation }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; summary?: { bots?: number; messages?: number } };
      if (!response.ok) throw new Error(body.error || "NexBot could not wipe local data.");
      dispatch({ type: "wipe" });
      setMessage(`Wiped ${body.summary?.bots ?? 0} bots and ${body.summary?.messages ?? 0} messages.`);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-danger/30 bg-card p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-ink">Wipe local data</div>
          <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
            Deletes saved bots, chats, task files, memory, event logs, and schedules. Settings, credentials, and custom skills stay.
          </div>
        </div>
      </div>
      {!open ? (
        <button
          type="button"
          disabled={!configured}
          onClick={() => setOpen(true)}
          className="mt-3 min-h-11 w-full rounded-lg border border-danger/40 px-3 py-2 text-[13px] font-medium text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Open wipe local data confirmation"
        >
          {configured ? "Wipe local data…" : "Wipe protection is not configured"}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          <div className="rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">
            This action cannot be undone. Enter the wipe password and type <span className="font-semibold text-ink">WIPE</span>.
          </div>
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
            Wipe password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="min-h-11 rounded-lg border border-hairline/40 bg-inset px-3 text-[14px] text-ink focus:border-danger focus:outline-none"
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
            Type WIPE to confirm
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="min-h-11 rounded-lg border border-hairline/40 bg-inset px-3 text-[14px] uppercase tracking-[0.18em] text-ink focus:border-danger focus:outline-none"
              disabled={busy}
              spellCheck={false}
            />
          </label>
          {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
          {message && <div role="status" className="text-[12px] text-success">{message}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="min-h-11 flex-1 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !password || confirmation !== "WIPE"}
              className="min-h-11 flex-1 rounded-lg bg-danger px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="mx-auto animate-spin" /> : "Wipe now"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function KeepaliveSection() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.nexbot?.autostartStatus?.().then((s) => setOn(Boolean(s?.installed)));
  }, []);
  if (!window.nexbot?.autostartSet) return null;
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[15px] font-medium text-ink">Keep this PC as the host</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Start at logon, come back after a reboot or crash, stay in the tray. Sleep still pauses work — leave the PC on if you want 24/7.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={!!on}
          disabled={busy}
          onClick={() => {
            const next = !on;
            setBusy(true);
            void window.nexbot!.autostartSet(next).then((s) => {
              setOn(Boolean(s?.installed));
              setBusy(false);
            });
          }}
          className={cn(
            "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
            on ? "bg-accent" : "bg-raised",
          )}
        >
          <span
            className={cn(
              "absolute top-[3px] size-5 rounded-full bg-white transition-all",
              on ? "left-[21px]" : "left-[3px]",
            )}
          />
        </button>
      </div>
    </div>
  );
}


function modelLine(bot: Bot, instances: InstanceInfo[]): string {
  const sel = bot.modelSelection;
  const inst = instances.find((i) => i.instanceId === sel.instanceId);
  const label = inst?.models.options.find((o) => o.id === sel.model)?.label ?? sel.model;
  const provider = inst?.displayName || sel.instanceId;
  return provider && label ? `${provider} · ${label}` : label || provider || "no model";
}

function TeamSetupSection() {
  const { state } = useStore();
  const roster = state.bots.filter((b) => b.kind !== "group");

  return (
    <>
      <div className="mt-2 rounded-xl bg-card p-4">
        <div className="text-[15px] font-medium text-ink">Team Setup</div>
        <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
          Skills and scripts on this PC apply to the desk. Per-agent on/off lives on the bot Identity page. Computer use stays on this
          machine — there is no hosted box.
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-card p-4">
        <div className="text-[15px] font-medium text-ink">Desk roster</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">
          Local NexBots on this PC. Same list as the sidebar.
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {roster.length === 0 && (
            <div className="rounded-lg bg-inset px-3 py-3 text-[13px] text-ink-secondary">
              No NexBots yet. Add one from the sidebar.
            </div>
          )}
          {roster.map((bot) => (
            <div key={bot.id} className="flex items-center gap-3 rounded-lg bg-inset px-3 py-2.5">
              <NexAvatar color={bot.color} name={bot.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{bot.name}</div>
                <div className="truncate text-[12px] text-ink-secondary">{bot.title || "no title"}</div>
                <div className="truncate text-[11px] text-ink-secondary">
                  {modelLine(bot, state.instances)}
                  {bot.hidden ? " · hidden" : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-inset px-3 py-2.5 text-[13px] leading-relaxed text-ink-secondary">
          <Plus size={14} className="mt-0.5 shrink-0 text-ink" />
          <span>
            Add a NexBot with the <span className="text-ink">+</span> button in the sidebar
            (Add a NexBot). That is the only create path — Team Setup does not add a second one.
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-card p-4">
        <div className="text-[15px] font-medium text-ink">Skills and scripts</div>
        <div className="mt-3">
          <SkillsBody nested />
        </div>
      </div>
    </>
  );
}

function AppearanceSection() {
  return (
    <div className="mt-2 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Appearance</div>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
        Choose Light or Dark. The choice stays on this device.
      </div>
      <div
        className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-hairline/40 bg-raised px-3 py-2.5"
      >
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">Color theme</div>
          <div className="mt-1.5 text-[12px] leading-relaxed text-ink-secondary">
            Paper frost in Light, deeper surfaces and softer contrast in Dark.
          </div>
        </div>
        <ThemeToggle compact={false} className="shrink-0" />
      </div>
    </div>
  );
}

type SettingsTab = "general" | "plugins" | "team" | "appearance" | "updates";

export function AppSettingsPanel() {
  const { dispatch, state } = useStore();
  const [tab, setTab] = useState<SettingsTab>("general");
  const version = state.config?.version || APP_VERSION;
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "plugins", label: "Plugins" },
    { id: "team", label: "Team Setup" },
    { id: "appearance", label: "Appearance" },
    { id: "updates", label: "Updates" },
  ];

  return (
    <aside className="glass-heavy animate-panel-in flex h-full w-[420px] shrink-0 flex-col border-l border-black/8">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-6" />
        <span className="text-[15px] font-semibold text-ink">Settings</span>
        <button
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex gap-0.5 overflow-x-auto px-3 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[12px]",
              tab === t.id ? "bg-black/8 text-ink" : "text-ink-secondary hover:bg-black/4 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "plugins" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5">
            <ConnectorsBody embedded />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {tab === "general" && (
              <>
                <div className="mt-2 rounded-xl bg-card p-4">
                  <div className="text-[15px] font-medium text-ink">Profile</div>
                  <div className="mt-0.5 text-[13px] text-ink-secondary">
                    Shown in the sidebar. Saved locally as you leave each field.
                  </div>
                  <div className="mt-4">
                    <ProfileFields />
                  </div>
                </div>
                <ExpertModeSection />
                <KeepaliveSection />
                <SteerSection />
                <div className="mt-4 rounded-xl bg-card p-4">
                  <div className="text-[15px] font-medium text-ink">Connections</div>
                  <div className="mt-0.5 text-[13px] text-ink-secondary">
                    Shared by all bots. Values are write-only — after Save you only see Connected, never the
                    secret again.
                  </div>
                  <div className="mt-4 flex flex-col gap-4">
                    <ApiKeyRow
                      section="composio"
                      label="Composio Connect key"
                      placeholder="ck_…  connectors + agent tools"
                    />
                    <ApiKeyRow
                      section="composioApi"
                      label="Composio API key (optional)"
                      placeholder="ak_…  full app catalog + logos"
                    />
                    <ApiKeyRow
                      section="xai"
                      label="xAI API key (optional)"
                      placeholder="xai-…  API-key Grok driver only"
                    />
                  </div>
                  <div className="mt-3 rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">
                    Codex and Grok CLIs use your normal CLI logins — they do not need keys here.
                    Composio unlocks Gmail/Slack/etc. in Plugins. There is no cloud computer.
                  </div>
                </div>
                <ProvidersSection />
                <ComputerUseSection />
                <DesktopPermissions />
                <AboutSection />
                <WipeSection />
              </>
            )}
            {tab === "team" && <TeamSetupSection />}
            {tab === "appearance" && <AppearanceSection />}
            {tab === "updates" && (
              <div className="mt-2 rounded-xl bg-card p-4">
                <div className="text-[15px] font-medium text-ink">Updates</div>
                <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                  This install is NexBot v{version}. There is no in-app updater. A newer build is a new
                  installer when Charles ships one. Computer use stays on this PC.
                </div>
                <a
                  href="https://github.com/LuNexInc/nexbot/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
                >
                  GitHub releases <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
