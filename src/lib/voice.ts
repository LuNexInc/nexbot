// Read-aloud for bot replies via the renderer's speech synthesis.
// Windows/Linux Electron: Chromium voices. macOS: same API works; the native
// dictation helper is input-only, so playback stays here for every platform.

type Listener = (speakingId: string | null) => void;

let currentId: string | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener(currentId);
}

export function onSpeakingChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function speakingMessageId(): string | null {
  return currentId;
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  currentUtterance = null;
  if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
    if (currentId) {
      currentId = null;
      notify();
    }
    return;
  }
  // cancel() fires onend asynchronously; keep currentId until it lands so the
  // button does not flicker back to "play" for one frame mid-cancel.
  window.speechSynthesis.cancel();
}

/** Strip markdown and receipts so the voice reads prose, not syntax. */
export function textForSpeech(raw: string): string {
  const noFences = raw.replace(/```[\s\S]*?(?:```|$)/g, " …code… ");
  return (
    noFences
      // images and links: keep the label, drop the target
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // receipts like [receipt: thread/123] are noise out loud
      .replace(/\[receipt:[^\]]*\]/g, "")
      .replace(/(\*\*|__|\*|_|~~|`)/g, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-•*]\s+/gm, "")
      .replace(/^\s*(\d+)\.\s+/gm, "$1. ")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\|(?:[^|\n]+\|)+/g, (row) => row.replace(/\|/g, ", "))
      .replace(/ {2,}/g, " ")
      .trim()
  );
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const lang = navigator.language || "en-US";
  const byLang = (predicate: (v: SpeechSynthesisVoice) => boolean) =>
    voices.find((v) => predicate(v)) ?? null;
  return (
    byLang((v) => v.lang === lang && /natural|neural|premium/i.test(v.name)) ??
    byLang((v) => v.lang === lang && v.localService) ??
    byLang((v) => v.lang === lang) ??
    byLang((v) => v.lang.startsWith(lang.slice(0, 2))) ??
    voices[0]
  );
}

/**
 * Speak `text` tagged as `messageId`. Calling again with the same id stops
 * playback; a different id switches to the new message.
 * Returns true when this call started playback.
 */
export function toggleSpeak(messageId: string, rawText: string): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  if (currentId === messageId) {
    stopSpeaking();
    return false;
  }
  stopSpeaking();
  const text = textForSpeech(rawText);
  if (!text) return false;

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.04;
  utterance.onend = () => {
    if (currentUtterance === utterance) {
      currentUtterance = null;
      currentId = null;
      notify();
    }
  };
  utterance.onerror = () => {
    if (currentUtterance === utterance) {
      currentUtterance = null;
      currentId = null;
      notify();
    }
  };
  currentUtterance = utterance;
  currentId = messageId;
  window.speechSynthesis.speak(utterance);
  notify();
  return true;
}
