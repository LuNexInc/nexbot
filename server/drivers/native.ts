// Native (un-normalized) protocol tee — the debugging trick of writing the
// native protocol verbatim next to the canonical stream, so protocol drift can
// be diagnosed by diffing the two. Off with NEXBOT_NATIVE_LOG=0. Files rotate
// at 5 MB and drop after 14 days (see event-log.ts).
import { NATIVE_DIR } from "../config.ts";
import { appendNdjson, nativeLogEnabled } from "../event-log.ts";

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  if (!nativeLogEnabled()) return;
  try {
    appendNdjson(NATIVE_DIR, threadId, { at: new Date().toISOString(), ...entry });
  } catch {
    /* never let logging break a run */
  }
}
