import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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

function Shell() {
  const { state } = useStore();
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  // Windows titleBarOverlay draws caption buttons over the top of the window;
  // pad content so App Settings / chat header are not under the drag strip.
  const winPad = window.nexbot?.platform === "win32";
  return (
    <div className={`relative flex h-full bg-transparent ${winPad ? "pt-9" : ""}`}>
      <Sidebar />
      {bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          {state.connected ? (
            <>
              <div className="text-[15px] font-medium text-ink">No bots yet</div>
              <p className="max-w-[380px] text-center text-[14px] leading-relaxed">
                The desk starts with Chief of Staff and Research. Use the sidebar
                plus (Meet a teammate) to add more.
              </p>
            </>
          ) : (
            <>
              <Loader2 size={20} className="animate-spin" />
              <div className="text-[14px]">Connecting to the bot server…</div>
              <div className="text-[12px]">
                Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
              </div>
            </>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      {state.skillsOpen && <SkillsPanel />}
    </div>
  );
}

export default function App() {
  const [gated, setGated] = useState(() => !emailGateDone());
  useEffect(() => {
    initAnalytics();
  }, []);
  return (
    <StoreProvider>
      <Shell />
      {gated && <Onboarding onDone={() => setGated(false)} />}
    </StoreProvider>
  );
}
