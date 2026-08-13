// Live screen frames while a bot works on its cloud box.
// Frames stream to clients as SSE {kind:'screen'}; the final frame is
// folded into the transcript on turn end.

export type ScreenFrame = { png: string; mime: string };

export type ScreenPoller = {
  start(botId: string): void;
  /** Event-driven refresh: capture now instead of waiting for the next tick. */
  poke(botId: string): void;
  stop(botId: string): ScreenFrame | null;
};

export type ScreenPollerDeps = {
  isConfigured: () => boolean;
  screenshot: (botId: string) => Promise<{ png: string; format: string }>;
  onFrame: (botId: string, frame: ScreenFrame) => void;
  intervalMs?: number;
};

export function createScreenPoller(deps: ScreenPollerDeps): ScreenPoller {
  const intervalMs = deps.intervalMs ?? 4000;
  const pollers = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; capture: () => Promise<void>; last: ScreenFrame | null }
  >();

  function start(botId: string) {
    if (pollers.has(botId) || !deps.isConfigured()) return;
    let inFlight = false;
    const capture = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { png, format } = await deps.screenshot(botId);
        const frame: ScreenFrame = {
          png,
          mime: format === "jpeg" ? "image/jpeg" : "image/png",
        };
        entry.last = frame;
        deps.onFrame(botId, frame);
      } catch {
        /* box asleep or mid-command — try again next tick */
      } finally {
        inFlight = false;
      }
    };
    const entry = {
      timer: setInterval(capture, intervalMs),
      capture,
      last: null as ScreenFrame | null,
    };
    pollers.set(botId, entry);
  }

  function poke(botId: string) {
    void pollers.get(botId)?.capture();
  }

  function stop(botId: string): ScreenFrame | null {
    const entry = pollers.get(botId);
    if (!entry) return null;
    clearInterval(entry.timer);
    pollers.delete(botId);
    return entry.last;
  }

  return { start, poke, stop };
}
