import { useEffect, useState } from "react";
import { Check, Loader2, Mic, RefreshCw } from "lucide-react";
import { NexMark } from "./NexMark";
import { identifyEmail, setEmailGateDone, track } from "@/lib/analytics";

// First-run onboarding: profile, Chief of Staff setup, provider checks, and
// optional desktop permissions. Every check is skippable so onboarding never
// blocks the app.

type InstanceRow = {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: { state: "available" | "unavailable"; reason?: string; version?: string | null; authenticated?: boolean };
};

type BotRow = {
  id?: string;
  name: string;
  title?: string;
  description?: string;
  messages?: Array<{ id: string; role: "bot" | "user"; kind: string; text?: string; status?: string }>;
};

type ConfigRow = {
  composio?: { configured?: boolean };
};

const COS_JOB_OPTIONS = [
  "Manage my bots and priorities",
  "Keep my work organized",
  "Route work to the right NexBot",
] as const;

const isElectron = navigator.userAgent.includes("Electron");
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function StatusRow({
  ok,
  title,
  detail,
}: {
  ok: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3.5">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-[#00c97222] text-[#38d591]" : "bg-raised text-ink-secondary"
        }`}
      >
        {ok ? <Check size={14} /> : <span className="size-1.5 rounded-full bg-ink-secondary" />}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{detail}</div>
      </div>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [cosName, setCosName] = useState("Chief of Staff");
  const [cosJob, setCosJob] = useState("");
  const [cosCustomJob, setCosCustomJob] = useState("");
  const [cosLoaded, setCosLoaded] = useState(false);
  const [cosBusy, setCosBusy] = useState(false);
  const [cosError, setCosError] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceRow[] | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigRow | null>(null);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [cosBotId, setCosBotId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "passed" | "failed">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [perms, setPerms] = useState<{ mic: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const chosenCosJob = cosCustomJob.trim() || cosJob.trim();

  const saveProfile = () => {
    identifyEmail(email.trim().toLowerCase());
    // persisted server-side (~/.nexbot/config.json) — the sidebar
    // footer reads it back through /api/config
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
    }).catch(() => {});
    setStep(1);
  };

  const skipAll = () => {
    track("onboarding_skipped");
    setEmailGateDone("skipped");
    onDone();
  };

  // Escape always exits the wizard — a first-run modal must never trap the
  // user, no matter what a background request is doing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        skipAll();
      }
    };
    // Capture phase: setup is the topmost concern — one Esc exits everything.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  const refreshProviders = async () => {
    setCheckingProviders(true);
    setProviderError(null);
    try {
      const [instancesResponse, configResponse] = await Promise.all([
        fetch("/api/instances", { signal: AbortSignal.timeout(15_000) }),
        fetch("/api/config", { signal: AbortSignal.timeout(15_000) }),
      ]);
      if (!instancesResponse.ok) throw new Error("Could not check local providers.");
      const instanceBody = (await instancesResponse.json()) as { instances?: InstanceRow[] };
      setInstances(Array.isArray(instanceBody.instances) ? instanceBody.instances : []);
      if (configResponse.ok) setConfigStatus((await configResponse.json()) as ConfigRow);
      else setConfigStatus({});
    } catch (error) {
      setInstances([]);
      setProviderError(error instanceof Error ? error.message : "Could not check local providers.");
    } finally {
      setCheckingProviders(false);
    }
  };

  useEffect(() => {
    track("onboarding_step", { step });
    if (step === 1 && !cosLoaded) {
      fetch("/api/bots", { signal: AbortSignal.timeout(15_000) })
        .then((r) => r.json())
        .then((d) => {
          const bots = (Array.isArray(d.bots) ? d.bots : []) as BotRow[];
          const cos = bots.find((bot) => /chief of staff/i.test(`${bot.name} ${bot.title ?? ""}`));
          if (cos) {
            if (cos.id) setCosBotId(cos.id);
            setCosName(cos.name || "Chief of Staff");
            if (cos.description && !/^manages your other bots/i.test(cos.description)) setCosCustomJob(cos.description);
          }
          setCosLoaded(true);
        })
        .catch(() => setCosLoaded(true));
    }
    if (step === 2 && !instances) {
      void refreshProviders();
    }
    if (step === 3 && !cosBotId) {
      fetch("/api/bots", { signal: AbortSignal.timeout(15_000) })
        .then((r) => r.json())
        .then((d) => {
          const bots = (Array.isArray(d.bots) ? d.bots : []) as BotRow[];
          const cos = bots.find((bot) => /chief of staff/i.test(`${bot.name} ${bot.title ?? ""}`));
          if (cos?.id) setCosBotId(cos.id);
        })
        .catch(() => {});
    }
    if (step === 5 && isElectron) {
      const poll = () => window.nexbot?.permStatus?.().then(setPerms).catch(() => {});
      poll();
      // keep polling — the user may grant in System Settings and come back
      const t = setInterval(poll, 2000);
      return () => clearInterval(t);
    }
  }, [step, instances, cosLoaded, configStatus, cosBotId]);

  const saveChiefOfStaff = async () => {
    if (!cosName.trim() || !chosenCosJob) return;
    setCosBusy(true);
    setCosError(null);
    try {
      const response = await fetch("/api/onboarding/chief-of-staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: cosName.trim(), job: chosenCosJob }),
        // A hung harness must strand nobody — the Skip button stays live.
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; bot?: { id?: string } };
      if (!response.ok) throw new Error(body.error || "Could not set up the Chief of Staff.");
      if (body.bot?.id) setCosBotId(body.bot.id);
      track("onboarding_cos_setup");
      setStep(2);
    } catch (error) {
      setCosError(error instanceof Error ? error.message : String(error));
    } finally {
      setCosBusy(false);
    }
  };

  const sendReadinessCheck = async () => {
    if (!cosBotId || testStatus === "sending") return;
    setTestStatus("sending");
    setTestError(null);
    const clientNonce = `onboarding-check-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const beforeResponse = await fetch(`/api/bots/${cosBotId}`);
      if (!beforeResponse.ok) throw new Error("Could not read the Chief of Staff thread.");
      const beforeBody = (await beforeResponse.json()) as { bot?: BotRow };
      const beforeBot = beforeBody.bot;
      const existingMessageIds = new Set((beforeBot?.messages ?? []).map((message) => message.id));

      const response = await fetch(`/api/bots/${cosBotId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Reply with one short sentence so I know setup works.",
          clientNonce,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not send the test message.");

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(500);
        const checkResponse = await fetch(`/api/bots/${cosBotId}`);
        if (!checkResponse.ok) continue;
        const checkBody = (await checkResponse.json()) as { bot?: BotRow };
        const reply = (checkBody.bot?.messages ?? []).find(
          (message) =>
            !existingMessageIds.has(message.id) &&
            message.role === "bot" &&
            message.kind === "text" &&
            message.status !== "failed" &&
            Boolean(message.text?.trim()),
        );
        if (reply) {
          setTestStatus("passed");
          track("onboarding_readiness_check", { result: "passed" });
          return;
        }
      }
      throw new Error("The Chief of Staff did not reply within 30 seconds. You can continue and try again in chat.");
    } catch (error) {
      setTestStatus("failed");
      setTestError(error instanceof Error ? error.message : "The readiness check failed.");
      track("onboarding_readiness_check", { result: "failed" });
    }
  };

  const finish = () => {
    track("onboarding_completed", {
      engines_available: instances?.filter((i) => i.snapshot.state === "available").length ?? -1,
      mic: perms?.mic ?? "n/a",
    });
    setEmailGateDone("submitted");
    onDone();
  };

  const byKind = (kind: string) => instances?.find((i) => i.driverKind === kind);
  const claude = byKind("claudeAgent");
  const codex = byKind("codex");
  const grok = byKind("grokAgent") ?? byKind("grok");
  const antigravity = byKind("antigravity");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-app/80 backdrop-blur-xl">
      <div className="glass-heavy flex w-[460px] flex-col rounded-2xl p-8">
        {step === 0 && (
          <div className="flex flex-col items-center">
            <NexMark className="size-16 text-ink" guides={1} />
            <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">Welcome to NexBot</h1>
            <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">
              Set your name and company name for this workspace. These details
              stay on this machine only. NexBot does not ship analytics.
            </p>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mt-5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Company name"
              className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && valid && saveProfile()}
              placeholder="you@example.com"
              className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <button
              onClick={saveProfile}
              disabled={!valid}
              className="pressable mt-3 w-full rounded-full bg-ink py-2.5 text-[15px] font-medium text-app disabled:opacity-40"
            >
              Continue
            </button>
            <button
              onClick={() => {
                track("email_skipped");
                setStep(1);
              }}
              className="mt-3 text-[12px] text-ink-secondary hover:text-ink"
            >
              Maybe later
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Meet your Chief of Staff</h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-secondary">
              Give your Chief of Staff a name and one main job. You can change both later in the NexBot settings.
            </p>
            <input
              autoFocus
              type="text"
              value={cosName}
              onChange={(e) => setCosName(e.target.value)}
              placeholder="Chief of Staff name"
              className="mt-5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
              disabled={cosBusy}
            />
            <div className="mt-4 flex flex-col gap-2">
              <div className="text-[12px] font-medium text-ink-secondary">Main job</div>
              {COS_JOB_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setCosJob(option);
                    setCosCustomJob("");
                  }}
                  aria-pressed={cosJob === option && !cosCustomJob}
                  disabled={cosBusy}
                  className={`min-h-11 rounded-lg border px-3 text-left text-[14px] transition-colors ${
                    cosJob === option && !cosCustomJob
                      ? "border-ink bg-ink/8 font-medium text-ink"
                      : "border-hairline/40 bg-inset text-ink hover:bg-raised"
                  }`}
                >
                  {option}
                </button>
              ))}
              <input
                type="text"
                value={cosCustomJob}
                onChange={(e) => setCosCustomJob(e.target.value)}
                placeholder="Or type the main job"
                className="mt-1 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
                disabled={cosBusy}
              />
            </div>
            {cosError && <div className="mt-3 text-[12px] text-danger">{cosError}</div>}
            <button
              onClick={saveChiefOfStaff}
              disabled={cosBusy || !cosName.trim() || !chosenCosJob}
              className="pressable mt-4 w-full rounded-full bg-ink py-2.5 text-[15px] font-medium text-app disabled:opacity-40"
            >
              {cosBusy ? <Loader2 size={16} className="mx-auto animate-spin" /> : "Continue"}
            </button>
            <button
              onClick={() => {
                track("onboarding_cos_skipped");
                setStep(2);
              }}
              className="mt-3 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[18px] font-semibold text-ink">Your providers</h1>
                <p className="mt-1 text-[13.5px] text-ink-secondary">
                  Bots can use the AI tools installed on this computer. Add or sign in to any provider you want to use.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshProviders()}
                disabled={checkingProviders}
                className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
                title="Refresh provider checks"
                aria-label="Refresh provider checks"
              >
                <RefreshCw size={16} className={checkingProviders ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2.5">
              {!instances || checkingProviders ? (
                <div className="flex items-center gap-2 py-6 text-ink-secondary">
                  <Loader2 size={16} className="animate-spin" /> Checking…
                </div>
              ) : (
                <>
                  <StatusRow
                    ok={grok?.snapshot.state === "available"}
                    title={`Grok Build ${grok?.snapshot.version ? `· ${grok.snapshot.version.split(" ")[1]}` : ""}`}
                    detail={
                      grok?.snapshot.state === "available"
                        ? grok.snapshot.authenticated
                          ? "Installed and signed in — the default for new bots."
                          : "Installed. Run `grok login` in a terminal to sign in. Grok is the default for new bots."
                        : "Optional. Install if you want Grok: curl -fsSL https://x.ai/cli/install.sh | bash"
                    }
                  />
                  <StatusRow
                    ok={codex?.snapshot.state === "available"}
                    title={`Codex ${codex?.snapshot.version ? `· ${codex.snapshot.version.replace("codex-cli ", "")}` : ""}`}
                    detail={
                      codex?.snapshot.state === "available"
                        ? "Installed — optional, bots can run on Codex too."
                        : "Optional. Install: npm i -g @openai/codex"
                    }
                  />
                  <StatusRow
                    ok={antigravity?.snapshot.state === "available"}
                    title={`Antigravity${antigravity?.snapshot.version ? ` · agy ${antigravity.snapshot.version}` : ""}`}
                    detail={
                      antigravity?.snapshot.state === "available"
                        ? "Installed and ready. Bots can use the agy CLI when you select Antigravity."
                        : "Optional. Install and sign in to the agy CLI if you want Antigravity."
                    }
                  />
                  <StatusRow
                    ok={claude?.snapshot.state === "available"}
                    title={`Claude Code ${claude?.snapshot.version ? `· ${claude.snapshot.version.split(" ")[0]}` : ""}`}
                    detail={
                      claude?.snapshot.state === "available"
                        ? claude.snapshot.authenticated
                          ? "Installed and signed in — optional."
                          : "Installed. Optional — run `claude` once in a terminal to sign in."
                      : "Optional. Not required to get started."
                    }
                  />
                  <StatusRow
                    ok={Boolean(configStatus?.composio?.configured)}
                    title="Connected apps · Composio"
                    detail={
                      configStatus === null
                        ? "Checking optional app connections…"
                        : configStatus.composio?.configured
                          ? "Connected apps are ready. Manage Gmail, Slack, and other services in Plugins."
                      : "Optional. Composio is a connection service, not a local CLI. Add its key later in Settings → Plugins."
                    }
                  />
                  {instances.length > 0 && instances.every((instance) => instance.snapshot.state !== "available") && (
                    <div className="rounded-xl border border-warning/25 bg-warning/8 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
                      No provider is ready yet. NexBot can finish setup, but it cannot answer until you install and sign in to a supported CLI or configure an API provider.
                    </div>
                  )}
                  {providerError && (
                    <div className="rounded-xl border border-danger/20 bg-danger/8 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
                      {providerError} Use the refresh button after the bot server is ready.
                    </div>
                  )}
                </>
              )}
            </div>
            <button
              onClick={() => setStep(3)}
              className="pressable mt-5 w-full rounded-full bg-ink py-2.5 text-[15px] font-medium text-app"
            >
              Continue
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Check your first message</h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-secondary">
              Send one short test to your Chief of Staff. NexBot will wait for a reply so you know the selected provider is ready before you start.
            </p>
            {testStatus === "passed" ? (
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#00c97233] bg-[#00c97212] p-3.5 text-[13px] text-ink">
                <Check size={18} className="mt-0.5 shrink-0 text-[#38d591]" />
                <div>
                  <div className="font-medium">Chief of Staff replied</div>
                  <div className="mt-0.5 text-ink-secondary">Your first message is ready. You can continue setup.</div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-xl bg-card p-3.5 text-[13px] leading-relaxed text-ink-secondary">
                This sends: <span className="font-medium text-ink">“Reply with one short sentence so I know setup works.”</span>
              </div>
            )}
            {testError && <div className="mt-3 text-[12px] text-danger">{testError}</div>}
            {!cosBotId && <div className="mt-3 text-[12px] text-ink-secondary">Chief of Staff is not set up yet. You can skip this check.</div>}
            <button
              onClick={() => (testStatus === "passed" ? setStep(4) : void sendReadinessCheck())}
              disabled={!cosBotId || testStatus === "sending"}
              className="pressable mt-4 flex min-h-10 w-full items-center justify-center rounded-full bg-ink py-2.5 text-[15px] font-medium text-app disabled:opacity-40"
            >
              {testStatus === "sending" ? <><Loader2 size={16} className="mr-2 animate-spin" /> Waiting for reply…</> : testStatus === "passed" ? "Continue" : testStatus === "failed" ? "Try again" : "Send test message"}
            </button>
            <button
              onClick={() => {
                track("onboarding_readiness_check", { result: "skipped" });
                setStep(4);
              }}
              disabled={testStatus === "sending"}
              className="mt-3 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">This PC is the computer</h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-secondary">
              Work dies if this PC sleeps, logs off, or you Quit NexBot. Close the
              window to leave the tray running. Your NexBot library offers six
              specialist roles: Builder, Spark, Research, Communications, Operations,
              and Creative. Add the roles you need from the + button after setup.
              Your Chief of Staff is the seventh role.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[13px] text-ink">
              <div className="rounded-xl bg-card p-3.5">Builder — projects and builds</div>
              <div className="rounded-xl bg-card p-3.5">Spark — ideas and creative work</div>
              <div className="rounded-xl bg-card p-3.5">Research — sources and briefings</div>
              <div className="rounded-xl bg-card p-3.5">Communications — messages and outreach</div>
              <div className="rounded-xl bg-card p-3.5">Operations — process and follow-through</div>
              <div className="rounded-xl bg-card p-3.5">Creative — design and direction</div>
            </div>
            <button
              onClick={() => (isElectron ? setStep(5) : finish())}
              className="pressable mt-5 w-full rounded-full bg-ink py-2.5 text-[15px] font-medium text-app"
            >
              Continue
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Permissions</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              Optional, and only ever used when you ask for the feature.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-card p-3.5">
                <div className="flex items-start gap-3">
                  <Mic size={18} className="mt-0.5 shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[14px] font-medium text-ink">Microphone & speech</div>
                    <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                      Voice dictation into the composer, transcribed on-device.
                    </div>
                  </div>
                </div>
                {perms?.mic === "granted" ? (
                  <Check size={16} className="shrink-0 text-[#38d591]" />
                ) : perms?.mic === "denied" || perms?.mic === "restricted" ? (
                  <button
                    onClick={() => window.nexbot?.permOpenSettings?.("mic")}
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    Open Settings
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      window.nexbot?.permRequestMic?.().then(() => window.nexbot?.permStatus?.().then(setPerms))
                    }
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    Enable
                  </button>
                )}
              </div>
              {/* Screen Recording deliberately has no row here: macOS 15+
                  makes a pre-grant unreliable (per-process status caching,
                  helper misattribution, periodic re-prompts) — the OS flow
                  triggers on the first real capture in the Computer panel,
                  which is the moment the user has context for the dialog. */}
            </div>
            <button onClick={finish} className="pressable mt-5 w-full rounded-full bg-ink py-2.5 text-[15px] font-medium text-app">
              Start using NexBot
            </button>
            <button onClick={finish} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">
              Skip for now
            </button>
          </div>
        )}

        {step > 0 && (
          <button
            type="button"
            onClick={skipAll}
            className="mt-5 self-center text-[12px] text-ink-secondary hover:text-ink"
          >
            Skip setup — finish later in Settings
          </button>
        )}
      </div>
    </div>
  );
}
