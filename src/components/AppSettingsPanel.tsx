// App-level settings: profile, connection keys, agent CLI status,
// desktop permissions, About. No third-party product analytics.
import { Check, ClipboardCopy, Copy, Download, ExternalLink, Loader2, Mic, Monitor, Plus, QrCode, RefreshCw, RotateCw, ShieldAlert, ShieldCheck, Smartphone, Trash2, Upload, Wifi, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useStore, type Bot, type InstanceInfo, type RemoteAccessStatus, type WireGuardStatus } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { ConnectorsBody } from "./PluginsPanel";
import { SkillsBody } from "./SkillsPanel";
import { NexAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { ExpertToggle } from "./ExpertToggle";
import { ThemeToggle } from "./ThemeToggle";

/** Injected by Vite `define` from package.json — never hardcode again. */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

/** Export the team roster (no secrets, no transcripts) as a portable JSON file. */
function exportTeamConfig(bots: Bot[]): void {
  const roster = bots
    .filter((b) => b.kind !== "group")
    .map((b) => ({
      name: b.name,
      title: b.title,
      description: b.description,
      personality: b.personality ?? "",
      color: b.color,
      modelSelection: b.modelSelection,
      memoryEnabled: b.memoryEnabled ?? false,
      notifications: b.notifications,
      proactiveEnabled: b.proactiveEnabled ?? false,
    }));
  const payload = { app: "nexbot", version: 1, exportedAt: new Date().toISOString(), bots: roster };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nexbot-team-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Team backup: one-click export / guided re-import of agent identities. */
function TeamConfigSection() {
  const { state } = useStore();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    setBusy(true);
    setStatus(null);
    try {
      const data = JSON.parse(await file.text()) as { app?: string; bots?: Array<Record<string, unknown>> };
      if (data.app !== "nexbot" || !Array.isArray(data.bots)) throw new Error("not a NexBot team file");
      let added = 0;
      for (const bot of data.bots) {
        const exists = state.bots.some((b) => b.name.toLowerCase() === String(bot.name ?? "").toLowerCase());
        if (exists) continue; // skip duplicates instead of clobbering live agents
        await fetch("/api/bots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(bot),
        });
        added += 1;
      }
      setStatus(`Imported ${added} agent${added === 1 ? "" : "s"}. Duplicates were skipped.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Team backup</div>
      <div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
        Export agent identities (names, roles, talking style, models) to a JSON file you can re-import on
        another PC or after a reinstall. Secrets and transcripts are never included.
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => exportTeamConfig(state.bots)}
          disabled={state.bots.length === 0}
          className="pressable flex min-h-9 items-center gap-1.5 rounded-lg border border-black/12 px-3 text-[13px] font-medium text-ink-secondary hover:bg-black/6 hover:text-ink disabled:opacity-40"
        >
          <Download size={14} /> Export team
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="pressable flex min-h-9 items-center gap-1.5 rounded-lg border border-black/12 px-3 text-[13px] font-medium text-ink-secondary hover:bg-black/6 hover:text-ink disabled:opacity-40"
        >
          <Upload size={14} /> Import team
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      {status && <div className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{status}</div>}
    </div>
  );
}

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
  const [adding, setAdding] = useState(false);
  const [instanceId, setInstanceId] = useState("");
  const [cli, setCli] = useState("");
  const [args, setArgs] = useState("");
  const [model, setModel] = useState("default");

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
              {row.driverKind === "acp" && (
                <button
                  type="button"
                  title="Remove custom ACP provider"
                  onClick={() => void fetch(`/api/instances/${row.instanceId}`, { method: "DELETE" }).then(refresh)}
                  className="rounded p-1 text-ink-secondary hover:bg-raised hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {adding ? (
        <form
          className="mt-3 flex flex-col gap-2 rounded-lg border border-hairline/40 bg-inset p-3"
          onSubmit={(event) => {
            event.preventDefault();
            let parsedArgs: string[];
            try { parsedArgs = args.trim().startsWith("[") ? JSON.parse(args) : args.split(/\s+/).filter(Boolean); } catch { return; }
            void fetch("/api/instances", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ instanceId, displayName: instanceId, cli, args: parsedArgs, model }),
            }).then((response) => response.json()).then((data) => {
              if (data.instances) dispatch({ type: "instances", instances: data.instances });
              setAdding(false);
            });
          }}
        >
          <div className="text-[13px] font-medium text-ink">Add an ACP CLI</div>
          <input value={instanceId} onChange={(event) => setInstanceId(event.target.value)} placeholder="Instance id, for example goose" className="rounded-lg border border-hairline/40 bg-surface px-3 py-2 text-[13px]" required />
          <input value={cli} onChange={(event) => setCli(event.target.value)} placeholder="CLI command or full path" className="rounded-lg border border-hairline/40 bg-surface px-3 py-2 text-[13px]" required />
          <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder={'ACP arguments, for example ["acp","serve"]'} className="rounded-lg border border-hairline/40 bg-surface px-3 py-2 text-[13px]" />
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model id" className="rounded-lg border border-hairline/40 bg-surface px-3 py-2 text-[13px]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-2 text-[12px] text-ink-secondary">Cancel</button>
            <button type="submit" className="rounded-lg bg-ink px-3 py-2 text-[12px] text-paper">Add provider</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline">
          <Plus size={13} /> Add ACP provider
        </button>
      )}
    </div>
  );
}

type CredentialRow = { id: string; label: string; envName: string; botIds: string[] };

function CredentialsSection() {
  const { state } = useStore();
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [label, setLabel] = useState("");
  const [envName, setEnvName] = useState("");
  const [secret, setSecret] = useState("");
  const [botIds, setBotIds] = useState<string[]>([]);
  const refresh = useCallback(() => {
    void fetch("/api/credentials").then((response) => response.json()).then((data) => setRows(data.credentials ?? [])).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  const specialists = state.bots.filter((bot) => bot.kind !== "group" && !bot.hidden);
  const toggleGrant = (row: CredentialRow, botId: string) => {
    const next = row.botIds.includes(botId) ? row.botIds.filter((id) => id !== botId) : [...row.botIds, botId];
    void fetch(`/api/credentials/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botIds: next }),
    }).then(refresh);
  };
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Credential vault</div>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
        Secrets are encrypted locally. A granted bot can type one into the focused local field. The value is not shown in chat.
      </div>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void fetch("/api/credentials", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label, envName, secret, botIds }),
          }).then((response) => response.json()).then(() => {
            setLabel(""); setEnvName(""); setSecret(""); setBotIds([]); refresh();
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Credential label" className="rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px]" required />
          <input value={envName} onChange={(event) => setEnvName(event.target.value.toUpperCase())} placeholder="ENV_NAME" className="rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px]" required />
        </div>
        <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Secret value" autoComplete="off" className="rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px]" required />
        <div className="flex flex-wrap gap-2">
          {specialists.map((bot) => (
            <label key={bot.id} className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
              <input type="checkbox" checked={botIds.includes(bot.id)} onChange={() => setBotIds((current) => current.includes(bot.id) ? current.filter((id) => id !== bot.id) : [...current, bot.id])} />
              {bot.name}
            </label>
          ))}
        </div>
        <button type="submit" className="self-start rounded-lg bg-ink px-3 py-2 text-[12px] text-paper">Save credential</button>
      </form>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-hairline/40 bg-inset p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div><span className="text-[13px] font-medium text-ink">{row.label}</span><span className="ml-2 text-[11px] text-ink-secondary">{row.envName}</span></div>
              <button type="button" onClick={() => void fetch(`/api/credentials/${row.id}`, { method: "DELETE" }).then(refresh)} className="rounded p-1 text-ink-secondary hover:text-danger"><Trash2 size={13} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {specialists.map((bot) => (
                <label key={bot.id} className="flex items-center gap-1 text-[11px] text-ink-secondary">
                  <input type="checkbox" checked={row.botIds.includes(bot.id)} onChange={() => toggleGrant(row, bot.id)} /> {bot.name}
                </label>
              ))}
            </div>
          </div>
        ))}
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

type DoctorReport = { overall: "pass" | "warn" | "fail"; checks: Array<{ id: string; status: "pass" | "warn" | "fail"; detail: string }> };

function DoctorSection() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(false);
  const run = useCallback(() => {
    setChecking(true);
    void fetch("/api/doctor")
      .then((response) => response.json())
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setChecking(false));
  }, []);
  useEffect(run, [run]);
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium text-ink">System health</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">The same checks are available with pnpm doctor.</div>
        </div>
        <button type="button" onClick={run} disabled={checking} title="Run health checks" className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
          <RefreshCw size={15} className={cn(checking && "animate-spin")} />
        </button>
      </div>
      {report && (
        <div className="mt-3 flex flex-col gap-1.5">
          {report.checks.map((check) => (
            <div key={check.id} className="flex items-start gap-2 rounded-lg bg-inset px-2.5 py-2 text-[12px]">
              <span className={cn("mt-1 size-2 shrink-0 rounded-full", check.status === "pass" ? "bg-success" : check.status === "warn" ? "bg-warning" : "bg-danger")} />
              <span className="text-ink-secondary">{check.detail}</span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const lines = [
                `NexBot v${APP_VERSION || "unknown"} · ${navigator.userAgent}`,
                ...report.checks.map((c) => `[${c.status}] ${c.detail}`),
              ];
              void navigator.clipboard?.writeText(lines.join("\n"));
            }}
            className="pressable mt-1 flex min-h-9 items-center justify-center gap-1.5 self-start rounded-lg border border-black/12 px-3 text-[12px] font-medium text-ink-secondary hover:bg-black/6 hover:text-ink"
          >
            <ClipboardCopy size={13} /> Copy system report
          </button>
        </div>
      )}
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

type PairingCodeResult = { code: string; label: string; createdAt: number; expiresAt: number; pairingUrl: string; pairingUrls?: string[] };

function ConnectSection() {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [wireguard, setWireguard] = useState<WireGuardStatus | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [label, setLabel] = useState("Phone");
  const [pairingCode, setPairingCode] = useState<PairingCodeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

  const load = useCallback(() => {
    void fetch("/api/remote-access")
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not load Connect settings"); return body as RemoteAccessStatus; })
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void fetch("/api/remote-access/wireguard")
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not load VPN settings"); return body as WireGuardStatus; })
      .then((body) => { setWireguard(body); if (body.endpoint) setEndpoint(body.endpoint); })
      .catch(() => setWireguard(null));
  }, []);
  useEffect(load, [load]);

  const setMode = (mode: "off" | "lan") => {
    setBusy(true); setError("");
    void fetch("/api/remote-access", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not update Connect mode"); return body as RemoteAccessStatus; })
      .then(setStatus).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const create = () => {
    setBusy(true); setError("");
    void fetch("/api/remote-access/codes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not create pairing code"); return body as PairingCodeResult; })
      .then((body) => { setPairingCode(body); setLabel(""); load(); }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const rotate = (id: string, label: string) => {
    setBusy(true); setError("");
    void fetch("/api/remote-access/codes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, deviceId: id }) })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not create pairing code"); return body as PairingCodeResult; })
      .then((body) => { setPairingCode(body); load(); }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const revoke = (id: string) => {
    setBusy(true); setError("");
    void fetch(`/api/remote-access/devices/${id}`, { method: "DELETE" })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not revoke device"); })
      .then(load).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).catch(() => setError("Clipboard access is unavailable")); };
  const setupVpn = () => {
    setBusy(true); setError("");
    void fetch("/api/remote-access/wireguard", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: endpoint.trim() }) })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not set up the VPN"); return body as WireGuardStatus; })
      .then((body) => { setWireguard(body); setEndpoint(body.endpoint); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-raised p-2 text-ink"><ShieldCheck size={17} /></div><div className="min-w-0 flex-1"><div className="text-[15px] font-medium text-ink">NexBot Connect</div><div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">Pair a phone, tablet, or private VPN device with a device-scoped link. LAN access is off until you enable it.</div></div><button type="button" onClick={load} title="Refresh Connect settings" className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"><RefreshCw size={15} /></button></div>
      {!status ? <div className="mt-4 text-[12px] text-ink-secondary">Loading Connect settings…</div> : <>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><Wifi size={15} className="shrink-0 text-ink-secondary" /><div className="min-w-0"><div className="text-[13px] font-medium text-ink">Private LAN mode</div><div className="text-[11px] text-ink-secondary">Listens on local interfaces after restart</div></div></div><button role="switch" aria-checked={status.enabled} disabled={busy} onClick={() => setMode(status.enabled ? "off" : "lan")} className={cn("relative h-6 w-10 rounded-full transition", status.enabled ? "bg-ink" : "bg-raised-hover", busy && "opacity-50")}><span className={cn("absolute top-1 size-4 rounded-full bg-white transition", status.enabled ? "left-5" : "left-1")} /></button></div>
        {status.restartRequired && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">Restart NexBot to apply the new bind. The current process still listens on <code>{status.bind}</code>.</div>}
        <div className="mt-3 rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-secondary"><div className="flex items-center gap-1.5 font-medium text-ink"><Smartphone size={13} /> LAN and VPN boundary</div><p className="mt-1">LAN mode is for your home or office network. For access away from home, use a private VPN that you control. NexBot does not open a public port or configure router forwarding. The OS firewall and VPN are separate setup steps.</p>{status.lanAddresses.length > 0 && <p className="mt-1">Local addresses: {status.lanAddresses.join(", ")}</p>}</div>
        <div className="mt-4 rounded-lg border border-hairline/40 bg-inset p-3">
          <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-ink-secondary" /><div className="text-[13px] font-medium text-ink">Private VPN</div></div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">NexBot can provision a WireGuard peer for each paired phone. Install WireGuard for Windows on this host first. Use a public DNS name or reachable IP and forward the UDP port on your router for off-LAN access.</p>
          {!wireguard ? <div className="mt-2 text-[12px] text-ink-secondary">Checking WireGuard…</div> : !wireguard.available ? <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">{wireguard.reason ?? "WireGuard for Windows is not available on this host."}</div> : <>
            <div className="mt-3 flex gap-2"><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="vpn.example.com:51820" className={inputClass} /><button disabled={busy || !endpoint.trim()} onClick={setupVpn} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} {wireguard.configured ? "Apply VPN" : "Set up VPN"}</button></div>
            {wireguard.configured && <div className="mt-2 text-[11px] text-ink-secondary">{wireguard.active ? "VPN service is active" : "VPN is configured; service is not running"} · {wireguard.peerCount} active {wireguard.peerCount === 1 ? "device" : "devices"} · {wireguard.endpoint}</div>}
          </>}
        </div>
        {status.enabled && <div className="mt-4"><div className="mb-2 text-[13px] font-medium text-ink">Pair a device</div><div className="flex gap-2"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Device name" className={inputClass} /><button disabled={busy || !label.trim()} onClick={create} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"><QrCode size={14} /> Create code</button></div>{pairingCode && <div className="mt-3 flex items-center gap-4 rounded-lg border border-hairline/50 bg-white/70 p-3"><div className="shrink-0 rounded-md bg-white p-2"><QRCodeSVG value={pairingCode.pairingUrl} size={112} level="M" includeMargin /></div><div className="min-w-0"><div className="text-[12px] font-medium text-ink">Enter this code or scan the QR</div><div className="mt-1 font-mono text-[30px] font-semibold tracking-[0.22em] text-ink">{pairingCode.code}</div><div className="mt-1 text-[11px] leading-relaxed text-ink-secondary">Expires in 10 minutes. NexBot Connect uses the code once, then stores a device token securely.</div><button onClick={() => copy(pairingCode.code)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"><Copy size={13} /> Copy code</button></div></div>}</div>}
        {status.devices.length > 0 && <div className="mt-4"><div className="mb-2 text-[13px] font-medium text-ink">Devices</div><div className="flex flex-col gap-2">{status.devices.map((device) => <div key={device.id} className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2"><div className="min-w-0 flex-1"><div className="truncate text-[12px] text-ink">{device.label}</div><div className="text-[11px] text-ink-secondary">{device.active ? `Token ${device.tokenPrefix}…` : "Revoked"}</div></div>{device.active && <><button title="Create new pairing code" disabled={busy} onClick={() => rotate(device.id, device.label)} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised-hover hover:text-ink"><RotateCw size={14} /></button><button title="Revoke device" disabled={busy} onClick={() => revoke(device.id)} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised-hover hover:text-red-700"><Trash2 size={14} /></button></>}</div>)}</div></div>}
      </>}
      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}
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

type UpdateState = "unsupported" | "checking" | "up-to-date" | "downloading" | "ready" | "error";

/** In-app update status. The Electron main process owns electron-updater;
 * the renderer only renders what arrives over the narrow bridge. */
function UpdatesSection() {
  const { state } = useStore();
  const version = state.config?.version || APP_VERSION || "0.0.0";
  const [update, setUpdate] = useState<{ state: UpdateState; version?: string; platform?: string }>({
    state: window.nexbot ? "checking" : "unsupported",
  });

  useEffect(() => {
    if (!window.nexbot) return;
    return window.nexbot.onUpdateStatus((info) => setUpdate({ state: info.state as UpdateState, version: info.version, platform: info.platform }));
  }, []);

  // In-app updates on macOS require a signed, notarized build; unsigned DMGs
  // never auto-update. Say so plainly instead of implying an update will come.
  const macUnsigned = update.platform === "darwin" && (update.state === "error" || update.state === "unsupported" || update.state === "checking" || update.state === "up-to-date");
  const copy: Record<UpdateState, { title: string; body: string }> = {
    unsupported: {
      title: `This install is NexBot v${version}`,
      body: macUnsigned
        ? "This macOS build checks the release feed, but in-app updates install only on signed builds. To update, download the latest installer from GitHub releases."
        : "Updates are checked automatically in the desktop app. A newer build is also available as an installer on GitHub releases.",
    },
    checking: { title: "Checking for updates…", body: "Talking to the release feed." },
    "up-to-date": {
      title: `You're up to date`,
      body: macUnsigned
        ? `NexBot v${version} is the newest published build. Future macOS in-app updates arrive once builds are signed; until then, install from GitHub releases.`
        : `NexBot v${version} is the newest published build.`,
    },
    downloading: { title: "Downloading update…", body: "NexBot downloads in the background and installs when you restart." },
    ready: {
      title: `Update ready${update.version ? ` — v${update.version}` : ""}`,
      body: "Restart NexBot to finish installing. Quitting to tray keeps bots working; the update applies on a full restart.",
    },
    error: {
      title: "Couldn't check for updates",
      body: macUnsigned
        ? "Unsigned macOS builds cannot install in-app updates. Download the latest installer from GitHub releases."
        : "The release feed was unreachable. You can always grab the latest installer from GitHub releases.",
    },
  };
  const tone =
    update.state === "ready" ? "border-accent/40 bg-accent/10" : update.state === "error" ? "border-warning/40 bg-warning/10" : "border-black/8 bg-card";

  return (
    <div className={cn("mt-2 rounded-xl border p-4", tone)}>
      <div className="text-[15px] font-medium text-ink">Updates</div>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{copy[update.state].body}</div>
      {update.state === "ready" && (
        <button
          type="button"
          onClick={() => void window.nexbot?.updateInstall()}
          className="pressable mt-3 min-h-9 rounded-lg bg-ink px-3.5 text-[13px] font-semibold text-white hover:opacity-90"
        >
          Restart to update
        </button>
      )}
      {(update.state === "unsupported" || update.state === "error") && (
        <a
          href="https://github.com/LuNexInc/nexbot/releases"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
        >
          GitHub releases <ExternalLink size={12} />
        </a>
      )}
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
              "absolute top-[3px] size-5 rounded-full bg-white transition-[left] duration-200",
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
  const { dispatch } = useStore();
  const [tab, setTab] = useState<SettingsTab>("general");
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
          type="button"
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="pressable rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label="Close app settings"
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
                <ConnectSection />
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
                <CredentialsSection />
                <ProvidersSection />
                <ComputerUseSection />
                <DoctorSection />
                <DesktopPermissions />
                <TeamConfigSection />
                <AboutSection />
                <WipeSection />
              </>
            )}
            {tab === "team" && <TeamSetupSection />}
            {tab === "appearance" && <AppearanceSection />}
            {tab === "updates" && <UpdatesSection />}
          </div>
        )}
      </div>
    </aside>
  );
}
