import { useEffect } from "react";

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "General",
    items: [
      ["Ctrl + K", "Command palette and message search"],
      ["Ctrl + 1 … 9", "Jump to a teammate"],
      ["Ctrl + ,", "App settings"],
      ["?", "This cheat sheet"],
      ["Esc", "Close panels and dialogs"],
    ],
  },
  {
    title: "In chat",
    items: [
      ["Enter", "Send message"],
      ["@", "Tag a teammate"],
      ["Esc", "Stop dictation"],
    ],
  },
];

/** Keyboard cheat sheet, toggled with "?" outside of text fields. */
export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-floating max-h-[80vh] w-full max-w-[520px] overflow-y-auto rounded-2xl p-6 shadow-2xl animate-spring-pop">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">Keyboard shortcuts</h2>
          <kbd className="rounded border border-black/10 bg-black/5 px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary">
            ESC
          </kbd>
        </div>
        {GROUPS.map((group) => (
          <div key={group.title} className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
              {group.title}
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {group.items.map(([keys, description]) => (
                <div key={keys} className="flex items-center justify-between gap-4 rounded-lg px-1 py-1.5">
                  <span className="text-[13px] text-ink-secondary">
                    {description}
                  </span>
                  <kbd className="shrink-0 rounded border border-black/10 bg-black/5 px-2 py-0.5 font-mono text-[11px] text-ink">
                    {isMac ? keys.replaceAll("Ctrl", "⌘") : keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
