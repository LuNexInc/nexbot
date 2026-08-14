import { useState } from "react";
import { ComputerIcon, CloseIcon } from "./icons";
import { useStore, type Bot } from "@/state/store";
import { Maximize2 } from "lucide-react";

export function ComputerHUD({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [minimized, setMinimized] = useState(false);

  const screen = state.screens[bot.id];
  if (!screen?.png || state.computerOpen) return null;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="pressable fixed bottom-24 right-6 z-30 flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3.5 py-2 text-[12px] font-medium text-ink shadow-xl backdrop-blur-md hover:bg-white"
        title="Show Computer HUD"
      >
        <ComputerIcon size={15} className="text-emerald-600 animate-pulse" />
        <span>Live Screen</span>
      </button>
    );
  }

  const src = screen.png.startsWith("data:")
    ? screen.png
    : `data:${screen.mime || "image/png"};base64,${screen.png}`;

  return (
    <div className="fixed bottom-24 right-6 z-30 overflow-hidden rounded-2xl border border-black/10 bg-black/85 text-white shadow-2xl backdrop-blur-xl animate-spring-pop w-[280px]">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px] font-medium text-gray-300">
        <div className="flex items-center gap-1.5">
          <ComputerIcon size={13} className="text-cyan-400" />
          <span className="font-mono text-[10px] tracking-wide uppercase">Computer HUD</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch({ type: "toggleComputer", open: true })}
            className="rounded p-1 hover:bg-white/10 hover:text-white"
            title="Expand full computer panel"
          >
            <Maximize2 size={12} />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="rounded p-1 hover:bg-white/10 hover:text-white"
            title="Minimize preview"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      </div>

      {/* Screen canvas with crosshair target */}
      <div className="relative aspect-video w-full bg-black/90">
        <img
          src={src}
          alt="Bot screen preview"
          className="size-full object-contain"
        />

        {/* Pulsing Coordinate Target Crosshair */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative flex size-8 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-cyan-400/80 animate-ping opacity-60" />
            <div className="size-4 rounded-full border border-cyan-300 bg-cyan-400/20 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <div className="absolute h-6 w-0.5 bg-cyan-300/80" />
            <div className="absolute h-0.5 w-6 bg-cyan-300/80" />
          </div>
        </div>
      </div>
    </div>
  );
}


