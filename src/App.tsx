import { useEffect, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { emailGateDone, initAnalytics } from "@/lib/analytics";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { SkillsPanel } from "@/components/SkillsPanel";

import { CommandPalette } from "@/components/CommandPalette";
import { ComputerHUD } from "@/components/ComputerHUD";
import { CrashBoundary } from "@/components/CrashBoundary";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

function ReconnectBanner() {
  const connected = useStore().state.connected;
  if (connected) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-warning/40 bg-warning/15 px-3.5 py-1.5 text-[12px] font-medium text-ink shadow-sm backdrop-blur"
    >
      <WifiOff size={13} className="text-warning" />
      Reconnecting to the local harness… your data is safe on disk.
    </div>
  );
}

function Shell() {
  const { state, dispatch } = useStore();
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 900);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  // Windows titleBarOverlay draws caption buttons over the top of the window;
  // pad content so App Settings / chat header are not under the drag strip.
  const winPad = window.nexbot?.platform === "win32";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
        return;
      }
      if (mod && e.key === ",") {
        // App settings, mirroring every mainstream desktop app.
        e.preventDefault();
        dispatch({ type: "toggleAppSettings" });
        return;
      }
      if (mod && e.key >= "1" && e.key <= "9") {
        const visible = state.bots.filter((b) => !b.hidden);
        const pick = visible[Number(e.key) - 1];
        if (pick) {
          e.preventDefault();
          dispatch({ type: "select", id: pick.id });
        }
        return;
      }
      if (e.key === "?" && !mod && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, state.bots]);

  useEffect(() => {
    const onResize = () => {
      const nextNarrow = window.innerWidth <= 900;
      setNarrow(nextNarrow);
      if (nextNarrow) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className={`relative flex h-full bg-transparent ${winPad ? "pt-9" : ""}`}>
      {!state.connected && state.bots.length > 0 && <ReconnectBanner />}
      {narrow && sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/20 max-[900px]:block"
          aria-label="Close sidebar"
        />
      )}
      <Sidebar open={sidebarOpen} />
      {bot ? (
        <ChatView bot={bot} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          {state.connected ? (
            <>
              <div className="text-[15px] font-medium text-ink">No bots yet</div>
              <p className="max-w-[380px] text-center text-[14px] leading-relaxed">
                The desk is ready for NexBots. Use the sidebar plus (Add a NexBot)
                to choose Chief of Staff, six specialist roles, or a custom role.
              </p>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: "newBot",
                    name: "Research",
                    title: "Research & briefings",
                    description: "Find sources and write concise briefings. Leave useful notes in your desk.",
                    color: "blue",
                  })
                }
                className="pressable rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90"
              >
                Add Research NexBot
              </button>
            </>
          ) : (
            <>
              {/* Skeleton loading: shape of the UI first, spinners never read as progress */}
              <div className="flex w-full max-w-[420px] flex-col gap-2.5 px-6">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-xl bg-black/5 dark:bg-white/8"
                    style={{ animationDelay: `${i * 120}ms`, width: `${100 - i * 9}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[13px]">
                <Loader2 size={14} className="animate-spin" />
                Starting your workspace…
              </div>
            </>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} initialPage={state.settingsPage} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {bot && <ComputerHUD bot={bot} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      {state.skillsOpen && <SkillsPanel />}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
export default function App() {
  const [gated, setGated] = useState(() => !emailGateDone());
  useEffect(() => {
    initAnalytics();
  }, []);
  return (
    <CrashBoundary>
      <StoreProvider>
        <Shell />
        {gated && <Onboarding onDone={() => setGated(false)} />}
      </StoreProvider>
    </CrashBoundary>
  );
}
