import { track } from "@/lib/analytics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Mic, Square } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { NexAvatar } from "./Avatar";

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
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ name: string; data: string }>>([]);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const q = mention.query.trim().toLowerCase();
    return state.bots
      .filter((b) => b.id !== bot.id && !b.hidden)
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, dismissedAt, state.bots, bot.id]);
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
    if ((!text.trim() && !files.length) || bot.busy) return;
    dispatch({
      type: "send",
      botId: bot.id,
      text: text.trim() || "See attached files.",
      files: files.length ? files : undefined,
    });
    track("message_sent", { driver: bot.modelSelection?.instanceId });
    setText("");
    setFiles([]);
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

  return (
    <div className="px-5 pb-5 pt-2">
      {speechError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div className="relative mx-auto max-w-[900px]">
        {pickerOpen && (
          <div className="glass-heavy absolute bottom-full left-10 z-20 mb-2 w-72 overflow-hidden rounded-xl shadow-lg">
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                <NexAvatar color={peer.color} name={peer.name} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">Agent</span>
              </button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 px-2 text-[12px] text-ink-secondary">
            {files.map((f) => (
              <span key={f.name} className="rounded-full bg-black/5 px-2 py-0.5">
                {f.name}
              </span>
            ))}
          </div>
        )}
        <div className="glass flex items-center gap-2 rounded-full py-2 pl-2 pr-2">
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
          className="pressable flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          title="Attach files"
        >
          <Plus size={20} />
        </button>
        <button
          type="button"
          onClick={insertMentionTrigger}
          className="pressable flex size-8 shrink-0 items-center justify-center rounded-full text-[16px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"
          title="Tag a teammate"
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
            if (e.key === "Enter") send();
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          placeholder={
            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name} · @ to tag`
          }
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        {bot.busy ? (
          <button
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop"
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : (
          <button
            onClick={toggleMic}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary hover:bg-raised hover:text-ink",
            )}
            title={recording ? "Stop dictation (Esc)" : "Dictate"}
          >
            <Mic size={18} />
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
