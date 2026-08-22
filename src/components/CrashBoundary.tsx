import { Component, type ErrorInfo, type ReactNode } from "react";

interface CrashState {
  hasError: boolean;
  error?: Error;
}

function hardReload() {
  // location.reload keeps the URL; the harness rehydrates everything from disk.
  window.location.reload();
}

/** Top-level safety net. If the React tree throws, the user gets a calm
 * recovery screen — never a white window. Transcripts live on disk in
 * ~/.nexbot, so nothing is lost by reloading. */
export class CrashBoundary extends Component<{ children: ReactNode }, CrashState> {
  state: CrashState = { hasError: false };

  static getDerivedStateFromError(error: Error): CrashState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("CrashBoundary:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const message = this.state.error?.message ?? "An unexpected error occurred.";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-app px-6 text-center">
        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4 max-w-[460px]">
          <h1 className="text-[16px] font-semibold text-ink">NexBot hit an unexpected error</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
            Your bots, transcripts, and settings are safe on disk in{" "}
            <code className="rounded bg-black/8 px-1.5 py-0.5 text-[12px]">~/.nexbot</code>. Reloading
            usually fixes this.
          </p>
          <p className="mt-3 break-words rounded-lg bg-black/5 px-3 py-2 text-left text-[12px] text-ink-secondary">
            {message}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={hardReload}
            className="pressable min-h-10 rounded-xl bg-ink px-4 text-[13px] font-semibold text-white hover:opacity-90"
          >
            Reload NexBot
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${message}\n${this.state.error?.stack ?? ""}`);
            }}
            className="pressable min-h-10 rounded-xl border border-black/12 px-4 text-[13px] font-medium text-ink-secondary hover:bg-black/6 hover:text-ink"
          >
            Copy error details
          </button>
        </div>
      </div>
    );
  }
}
