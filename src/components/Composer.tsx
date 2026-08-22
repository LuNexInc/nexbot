import { track } from "@/lib/analytics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Mic, Square } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { NexAvatar } from "./Avatar";
import {
  buildRoutingMessage,
  getClarificationChoices,
  shouldAskClarification,
  type ClarificationChoice,
} from "@/lib/clarification";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}
export function Composer({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"queue" | "steer" | "replace">("queue");
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const [clarification, setClarification] = useState<{
    text: string;
    choices: ClarificationChoice[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ name: string; data: string }>>([]);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const mentionPeers = useMemo(
    () => state.bots.filter((b) => b.id !== bot.id && !b.hidden),
    [state.bots, bot.id],
  );
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const q = mention.query.trim().toLowerCase();
    return mentionPeers
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, dismissedAt, mentionPeers]);
  const pickerOpen = candidates.length > 0;

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);

  const pickMention = (peer: Bot) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    setText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  /** Insert `@` at the caret so the existing picker opens — same path as typing `@`. */
  const insertMentionTrigger = () => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? caret;
    const current = mentionQueryAt(text, pos);
    if (current) {
      setDismissedAt(null);
      setCaret(pos);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(pos, pos);
      });
      return;
    }
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const insert = needsSpace ? " @" : "@";
    const next = `${before}${insert}${after}`;
    const newCaret = before.length + insert.length;
    setText(next);
    setCaret(newCaret);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const addImageFile = (file: File) => {
    if (files.length >= 6) return;
    if (file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const data = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
      setFiles((cur) => [...cur, { name: file.name || "paste.png", data }]);
    };
    reader.readAsDataURL(file);
  };

  const send = () => {
    const trimmed = text.trim();
    if ((!trimmed && !files.length) || clarification) return;
    if (!files.length && shouldAskClarification(trimmed, bot)) {
      const choices = getClarificationChoices(trimmed, state.bots, bot.id);
      if (choices.length >= 2) {
        setClarification({ text: trimmed, choices });
        return;
      }
    }
    dispatch({
      type: "send",
      botId: bot.id,
      text: trimmed || "See attached files.",
      delivery: bot.busy || bot.operatorControl ? delivery : undefined,
      files: files.length ? files : undefined,
    });
    track("message_sent", { driver: bot.modelSelection?.instanceId });
    setText("");
    setFiles([]);
  };

  const confirmClarification = (choice?: ClarificationChoice) => {
    if (!clarification) return;
    dispatch({
      type: "send",
      botId: bot.id,
      text: buildRoutingMessage(clarification.text, choice?.bot),
      delivery: bot.busy || bot.operatorControl ? delivery : undefined,
    });
    track("message_sent", {
      driver: bot.modelSelection?.instanceId,
      routing: choice ? "confirmed_teammate" : "chief_of_staff_choice",
    });
    setClarification(null);
    setText("");
  };

  // Dictation: macOS uses the native Swift helper via preload; Windows/Linux
  // (and browser) use Chromium Web Speech API.
  useEffect(() => {
    if (!recording) return;
    setSpeechError(null);
    const bridge = window.nexbot;
    let rec: {
      start(): void;
      stop(): void;
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((ev: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
    } | null = null;
    let offTranscript: (() => void) | undefined;
    let offEnd: (() => void) | undefined;
    let usedNative = false;

    const applySpoken = (spoken: string) => {
      const base = baseText.current;
      setText(base ? `${base} ${spoken.trim()}` : spoken.trim());
    };

    const startWebSpeech = () => {
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) {
        setSpeechError("Voice input is not supported in this browser or OS.");
        setRecording(false);
        return;
      }
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (ev) => {
        let textOut = "";
        for (let i = 0; i < ev.results.length; i++) {
          textOut += ev.results[i][0]?.transcript ?? "";
        }
        applySpoken(textOut);
      };
      rec.onerror = () => {
        setSpeechError("Microphone or speech recognition was blocked. Check OS privacy settings.");
        setRecording(false);
      };
      rec.onend = () => setRecording(false);
      try {
        rec.start();
      } catch {
        setSpeechError("Could not start speech recognition.");
        setRecording(false);
      }
    };

    if (bridge?.speechNative) {
      usedNative = true;
      offTranscript = bridge.onSpeechTranscript((line) => {
        if (typeof line.text === "string") applySpoken(line.text);
      });
      offEnd = bridge.onSpeechEnd(({ code }) => {
        if (code === 2) {
          // native unavailable — fall through to Web Speech
          startWebSpeech();
          return;
        }
        setRecording(false);
        if (code === 1) {
          setSpeechError(
            "Dictation needs Microphone + Speech Recognition access — open Privacy settings.",
          );
        }
      });
      void bridge.speechStart();
    } else {
      startWebSpeech();
    }

    return () => {
      offTranscript?.();
      offEnd?.();
      if (usedNative) void bridge?.speechStop?.();
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [recording]);

  const toggleMic = () => {
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  const removeFile = (idx: number) => {
    setFiles((cur) => cur.filter((_, i) => i !== idx));
  };

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 w-full px-5 pb-5 pt-2">
      {speechError && (
        <div className="pointer-events-auto mx-auto mb-2 max-w-[800px] rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div className="pointer-events-auto relative mx-auto max-w-[800px]">
        {(bot.busy || bot.operatorControl) && (
          <div className="mb-2 flex items-center justify-center gap-1 text-[11px] text-ink-secondary">
            <span className="mr-1">New message:</span>
            {(["queue", "steer", "replace"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={bot.operatorControl && mode === "replace"}
                onClick={() => setDelivery(mode)}
                className={cn(
                  "rounded-full px-2.5 py-1 capitalize transition-colors",
                  delivery === mode ? "bg-ink text-paper" : "bg-black/5 hover:bg-black/8",
                  bot.operatorControl && mode === "replace" && "cursor-not-allowed opacity-40",
                )}
                title={mode === "queue" ? "Run after existing queued messages" : mode === "steer" ? "Run next when the active turn ends" : "Stop the active turn and use this message instead"}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
        {clarification && (
          <div
            role="dialog"
            aria-label="Choose a teammate"
            aria-live="polite"
            className="glass-heavy absolute bottom-full left-0 right-0 z-20 mb-2 rounded-2xl border border-black/8 p-3 shadow-xl"
          >
            <div className="px-1">
              <p className="text-[14px] font-semibold text-ink">Which teammate should take this?</p>
              <p className="mt-0.5 text-[12px] text-ink-secondary">Pick a route, or let Chief of Staff decide.</p>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {clarification.choices.map((choice) => (
                <button
                  key={choice.bot.id}
                  type="button"
                  onClick={() => confirmClarification(choice)}
                  className="pressable flex min-h-11 items-center gap-2 rounded-xl border border-black/7 bg-black/[0.025] px-2.5 py-2 text-left transition-colors hover:border-black/15 hover:bg-black/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                  aria-label={`Route to ${choice.bot.name}`}
                >
                  <NexAvatar color={choice.bot.color} name={choice.bot.name} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">{choice.bot.name}</span>
                    <span className="block truncate text-[11px] text-ink-secondary">{choice.reason}</span>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => confirmClarification()}
              className="pressable mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border border-black/7 px-3 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
            >
              Just handle it — let Chief of Staff choose
            </button>
          </div>
        )}

        {pickerOpen && (
          <div
            id="nexbot-mention-picker"
            role="listbox"
            aria-label="NexBot teammates"
            className="glass-heavy absolute bottom-full left-4 z-30 mb-2 w-72 overflow-hidden rounded-2xl p-1 shadow-2xl"
          >
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                id={`nexbot-mention-${peer.id}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
                  i === highlight ? "bg-black/6" : "hover:bg-black/4",
                )}
              >
                <NexAvatar color={peer.color} name={peer.name} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 font-mono text-xs text-ink-secondary">Agent</span>
              </button>
            ))}
          </div>
        )}

        <div className="glass-floating flex flex-col gap-2 rounded-2xl p-2.5">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pt-0.5">
              {files.map((f, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border border-black/8 bg-black/4 px-2.5 py-1 text-[12px] text-ink"
                >
                  <span className="max-w-[140px] truncate">{f.name}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="flex min-h-11 min-w-11 items-center justify-center text-ink-secondary hover:text-ink"
                    title="Remove file"
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                void Promise.all(
                  list.map(
                    (file) =>
                      new Promise<{ name: string; data: string }>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const raw = String(reader.result ?? "");
                          const data = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
                          resolve({ name: file.name, data });
                        };
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                      }),
                  ),
                ).then((next) => setFiles((cur) => [...cur, ...next]));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pressable flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-black/6 hover:text-ink"
              title="Attach files"
              aria-label="Attach files"
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              onClick={insertMentionTrigger}
              disabled={mentionPeers.length === 0}
              className={cn(
                "pressable flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-ink-secondary hover:bg-black/6 hover:text-ink",
                mentionPeers.length === 0 && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-ink-secondary",
              )}
              title={mentionPeers.length === 0 ? "Add another NexBot to tag" : "Tag a NexBot (@)"}
              aria-label="Tag a NexBot"
            >
              @
            </button>

            <input
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setDismissedAt(null);
                setClarification(null);
              }}
              onKeyUp={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
              onClick={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData?.items ?? []);
                const images = items.filter((it) => it.type.startsWith("image/"));
                if (!images.length) return;
                e.preventDefault();
                for (const it of images.slice(0, 6 - files.length)) {
                  const file = it.getAsFile();
                  if (file) addImageFile(file);
                }
              }}
              onKeyDown={(e) => {
                if (pickerOpen) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const delta = e.key === "ArrowDown" ? 1 : -1;
                    setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pickMention(candidates[highlight]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDismissedAt(mention?.start ?? null);
                    return;
                  }
                }
                if (e.key === "Enter") {
                  // This is a single-line composer. Keep Enter deterministic:
                  // choose a visible @mention first, otherwise send the turn.
                  e.preventDefault();
                  send();
                  return;
                }
                if (e.key === "Escape" && recording) setRecording(false);
              }}
              aria-keyshortcuts="Enter"
              aria-controls={pickerOpen ? "nexbot-mention-picker" : undefined}
              aria-activedescendant={pickerOpen ? `nexbot-mention-${candidates[highlight]?.id}` : undefined}
              placeholder={
                recording ? "Listening…" : bot.operatorControl ? "Operator control is active — messages will queue" : bot.busy ? `Message while ${bot.name} works…` : `Message ${bot.name} · @ to tag`
              }
              className="w-full bg-transparent px-1 py-1 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />

            {bot.busy ? (
              <button
                onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
                className="pressable flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-black/8 text-ink-secondary hover:bg-black/12 hover:text-ink"
                title="Stop turn"
                aria-label="Stop turn"
              >
                <Square size={13} className="fill-current" />
              </button>
            ) : (
              <button
                onClick={toggleMic}
                className={cn(
                  "pressable flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                  recording
                    ? "animate-pulse bg-danger/20 text-danger"
                    : "text-ink-secondary hover:bg-black/6 hover:text-ink",
                )}
                title={recording ? "Stop dictation (Esc)" : "Dictate"}
                aria-label={recording ? "Stop dictation" : "Dictate"}
              >
                <Mic size={17} />
              </button>
            )}

            <button
              onClick={send}
              disabled={!text.trim() && !files.length}
              className={cn(
                "pressable flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                text.trim() || files.length
                  ? "bg-ink text-white shadow-sm hover:opacity-90"
                  : "bg-black/6 text-ink-secondary opacity-40 cursor-not-allowed",
              )}
              title="Send message (Enter)"
              aria-label="Send message"
            >
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
