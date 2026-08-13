// Local computer only (this PC). Cloud Box is not part of NexBot.
// Frames come from Electron main (desktopCapturer over the preload bridge).
import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Loader2, Monitor, Power, Settings, X } from "lucide-react";
import { api, useStore, type Bot, type Routine } from "@/state/store";
import { cn } from "@/lib/cn";

type Phase = "checking" | "local" | "local-unavailable" | "off";

function modeOf(bot: Bot): "local" | "off" {
  return bot.computer === "off" ? "off" : "local";
}

function kindLabel(r: Routine): string {
  const kind = r.kind ?? "cron";
  if (kind === "webhook") return "webhook";
  if (kind === "file") return `watching ${r.watchPath ?? ""}`;
  if (r.everyMinutes) return `cron every ${r.everyMinutes}m`;
  return `cron ${r.dailyAt ?? ""}`.trim();
}

/** Live this-PC frame: Electron capturer, else last screen message, else honest empty. */
export function useLiveScreenFrame(bot: Bot, opts?: { enabled?: boolean }) {
  const isElectron = Boolean(window.nexbot);
  const enabled = opts?.enabled ?? true;
  const [localFrame, setLocalFrame] = useState<string | null>(null);
  const [localMisses, setLocalMisses] = useState(0);

  useEffect(() => {
    setLocalFrame(null);
    setLocalMisses(0);
    if (!isElectron || !enabled) return;
    let alive = true;
    const shoot = async () => {
      try {
        const url = await window.nexbot!.screenFrame();
        if (alive && url) {
          setLocalFrame(url);
          setLocalMisses(0);
        } else if (alive) setLocalMisses((n) => n + 1);
      } catch {
        if (alive) setLocalMisses((n) => n + 1);
      }
    };
    void shoot();
    const timer = setInterval(shoot, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bot.id, isElectron, enabled]);

  const lastScreen = [...bot.messages].reverse().find((m) => m.kind === "screen" && m.png);
  const frameSrc =
    localFrame ??
    (lastScreen ? `data:${lastScreen.mime ?? "image/png"};base64,${lastScreen.png}` : null);
  return { frameSrc, isElectron, localMisses };
}

export function LiveScreenPreview({ bot, onOpen }: { bot: Bot; onOpen?: () => void }) {
  const { frameSrc } = useLiveScreenFrame(bot);
  const body = frameSrc ? (
    <img src={frameSrc} alt={`${bot.name}'s screen`} className="h-full w-full object-contain" />
  ) : (
    <span className="px-4 text-center text-[12px] text-ink-secondary">
      This PC — open Computer for a live view
    </span>
  );
  const cls = "flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-xl bg-card";
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={cls} title="Open computer">
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

export function RoutinesCard({ bot }: { bot: Bot }) {
  const [rows, setRows] = useState<Routine[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"cron" | "webhook" | "file">("cron");
  const [every, setEvery] = useState("60");
  const [secret, setSecret] = useState("");
  const [repo, setRepo] = useState("");
  const [watchPath, setWatchPath] = useState("");

  const load = () => {
    fetch(`/api/routines?botId=${bot.id}`)
      .then((r) => r.json())
      .then((d) => setRows(d.routines ?? []))
      .catch(() => {});
  };
  useEffect(load, [bot.id]);

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
        <CalendarClock size={16} className="text-ink-secondary" />
        Routines
      </div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Runs while NexBot is in the tray. Close the window; do not Quit.
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-2 rounded-lg bg-inset px-2.5 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-ink">{r.name}</div>
              <div className="text-[11px] text-ink-secondary">
                {kindLabel(r)}
                {r.enabled ? "" : " · paused"}
              </div>
              {(r.kind ?? "cron") === "webhook" && (
                <code className="mt-1 block break-all text-[10px] text-ink-secondary">
                  http://127.0.0.1:8799/api/routines/hooks/{r.id}
                </code>
              )}
            </div>
            <button
              onClick={() => api(`/api/routines/${r.id}`, { method: "DELETE" }).then(load)}
              className="text-[11px] text-ink-secondary hover:text-danger"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <input
        className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
        placeholder="What should this bot do?"
        value={prompt}
        rows={2}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {([
          ["cron", "Cron"],
          ["webhook", "Webhook"],
          ["file", "File watch"],
        ] as const).map(([value, label], i) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={cn(
              "flex-1 py-1.5 text-[13px]",
              i > 0 && "border-l border-hairline/40",
              kind === value ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "cron" && (
        <select
          className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
          value={every}
          onChange={(e) => setEvery(e.target.value)}
        >
          <option value="15">Every 15 minutes</option>
          <option value="60">Every hour</option>
          <option value="360">Every 6 hours</option>
          <option value="daily">Every day at 08:00</option>
        </select>
      )}
      {kind === "webhook" && (
        <>
          <input
            type="password"
            autoComplete="off"
            className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
            placeholder="Secret (required, x-nexbot-secret)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <input
            className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
            placeholder="Repo filter owner/name (optional)"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <div className="mt-1.5 text-[11px] text-ink-secondary">
            Required secret. POST the hook URL or /api/webhooks/github with x-nexbot-secret — unsigned hooks are ignored.
          </div>
        </>
      )}
      {kind === "file" && (
        <>
          <input
            className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink"
            placeholder="Path to file or directory"
            value={watchPath}
            onChange={(e) => setWatchPath(e.target.value)}
          />
          <div className="mt-1.5 text-[11px] text-ink-secondary">
            Required. File watch needs a path on this PC before it can be created.
          </div>
        </>
      )}
      <button
        onClick={() => {
          if (!prompt.trim()) return;
          if (kind === "file" && !watchPath.trim()) return;
          if (kind === "webhook" && !secret.trim()) return;
          api("/api/routines", {
            method: "POST",
            body: JSON.stringify({
              botId: bot.id,
              name: name.trim() || prompt.trim().slice(0, 40),
              prompt: prompt.trim(),
              kind,
              everyMinutes: kind === "cron" && every !== "daily" ? Number(every) : undefined,
              dailyAt: kind === "cron" && every === "daily" ? "08:00" : undefined,
              webhookSecret: kind === "webhook" && secret.trim() ? secret.trim() : undefined,
              githubRepo: kind === "webhook" && repo.trim() ? repo.trim() : undefined,
              watchPath: kind === "file" ? watchPath.trim() : undefined,
            }),
          }).then(() => {
            setName("");
            setPrompt("");
            setSecret("");
            setRepo("");
            setWatchPath("");
            load();
          });
        }}
        disabled={(kind === "file" && !watchPath.trim()) || (kind === "webhook" && !secret.trim())}
        className="pressable mt-3 w-full rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
      >
        Create routine
      </button>
    </div>
  );
}

type Caps = {
  screenPreview: { available: boolean };
  localComputer: { available: boolean; reasonCode?: string };
};

export function ComputerPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const mode = modeOf(bot);
  const isElectron = Boolean(window.nexbot);
  const [phase, setPhase] = useState<Phase>("checking");
  const [caps, setCaps] = useState<Caps | null>(null);
  const { frameSrc, localMisses } = useLiveScreenFrame(bot, { enabled: phase === "local" });

  useEffect(() => {
    const fromBridge = window.nexbot?.capabilities?.();
    void Promise.resolve(fromBridge)
      .then((c) => c ?? fetch("/api/capabilities").then((r) => r.json()))
      .then((c) => setCaps(c))
      .catch(() =>
        fetch("/api/capabilities")
          .then((r) => r.json())
          .then(setCaps)
          .catch(() => {}),
      );
  }, []);

  useEffect(() => {
    if (mode === "off") {
      setPhase("off");
      return;
    }
    if (!isElectron || (caps && !caps.screenPreview.available)) {
      setPhase("local-unavailable");
      return;
    }
    setPhase("local");
  }, [bot.id, mode, isElectron, caps]);

  return (
    <aside className="glass-heavy animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-black/8">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: true })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          title="Bot settings"
        >
          <Settings size={18} />
        </button>
        <span className="text-[15px] font-semibold text-ink">Computer</span>
        <button
          onClick={() => dispatch({ type: "toggleComputer", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mb-1.5 mt-2 flex items-center justify-between text-[13px] text-ink-secondary">
          <span>{bot.name}'s screen</span>
          {phase === "local" && <span className="text-[11px]">this PC</span>}
        </div>
        <div className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-xl bg-card">
          {frameSrc && phase !== "off" ? (
            <img src={frameSrc} alt={`${bot.name}'s screen`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
              {phase === "checking" || phase === "local" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : phase === "off" ? (
                <Power size={22} />
              ) : (
                <Monitor size={22} />
              )}
              <span className="text-[12px]">
                {phase === "off"
                  ? "This bot's computer is off"
                  : phase === "local-unavailable"
                    ? "Local preview needs the desktop app"
                    : localMisses >= 3
                      ? "No frames yet — grant screen capture, then try again."
                      : "Capturing this computer's screen…"}
              </span>
              {phase === "local" && localMisses >= 3 && (
                <button
                  onClick={() => window.nexbot?.permOpenSettings?.("screen")}
                  className="mt-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  Open Settings
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              if (window.nexbot?.openWatch) void window.nexbot.openWatch(bot.id);
              else window.open(`/watch.html?bot=${encodeURIComponent(bot.id)}`, "nexbot-watch");
            }}
            className="pressable flex flex-1 items-center justify-center gap-2 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
          >
            <ExternalLink size={14} />
            Open in window
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Runs on</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            This PC through CUA. NexBot does not use a cloud desktop.
          </div>
          <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
            {(
              [
                ["local", caps?.localComputer.available === false ? "This PC (CUA down)" : "This PC"],
                ["off", "Off"],
              ] as const
            ).map(([value, label], i) => (
              <button
                key={value}
                onClick={() => dispatch({ type: "updateBot", botId: bot.id, patch: { computer: value } })}
                className={cn(
                  "flex-1 py-1.5 text-[13px]",
                  i > 0 && "border-l border-hairline/40",
                  mode === value ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <RoutinesCard bot={bot} />
      </div>
    </aside>
  );
}
