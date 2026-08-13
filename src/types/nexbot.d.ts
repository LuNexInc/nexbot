// The narrow bridge the Electron preload exposes. Absent in the browser.
export {};

declare global {
  interface Window {
    nexbot?: {
      platform?: string;
      /** True on macOS when the native speech helper is used. */
      speechNative?: boolean;
      screenFrame(): Promise<string | null>;
      speechStart(): Promise<void>;
      speechStop(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null }) => void): () => void;
      permStatus(): Promise<{ mic: string }>;
      permRequestMic(): Promise<boolean>;
      permOpenSettings(pane: "mic" | "screen" | "speech"): Promise<void>;
      cuaConnection(): Promise<{
        mode?: string;
        reason?: string;
        installHint?: string;
        binary?: string;
        platform?: string;
      } | null>;
      cuaPermissions(): Promise<Record<string, unknown>>;
      cuaBinary(): Promise<string | null>;
      capabilities(): Promise<{
        host: { platform: string; label: string; packaged: boolean };
        screenPreview: { available: boolean; reasonCode?: string };
        dictation: { available: boolean; engine: string; reasonCode?: string };
        localComputer: { available: boolean; support: string; reasonCode?: string };
      }>;
      openWatch(botId?: string): Promise<void>;
      notify(title: string, body: string): Promise<void>;
      openPath(dir: string): Promise<string>;
      autostartStatus(): Promise<{ installed?: boolean; state?: string; error?: string }>;
      autostartSet(on: boolean): Promise<{ installed?: boolean; error?: string }>;
    };
    webkitSpeechRecognition?: new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start(): void;
      stop(): void;
      onresult: ((ev: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
    };
    SpeechRecognition?: Window["webkitSpeechRecognition"];
  }
}
