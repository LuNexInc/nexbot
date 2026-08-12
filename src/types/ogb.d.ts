// The narrow bridge the Electron preload exposes. Absent in the browser.
export {};

declare global {
  interface Window {
    ?: {
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
