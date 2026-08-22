// Native (un-normalized) protocol tee — the debugging trick of writing the
// native protocol verbatim next to the canonical stream, so protocol drift can
// be diagnosed by diffing the two. Off with NEXBOT_NATIVE_LOG=0. Files rotate
// at 5 MB and drop after 14 days (see event-log.ts).
import { NATIVE_DIR } from "../config.ts";
import { appendNdjson, nativeLogEnabled } from "../event-log.ts";

// The streams this tee records carry live secrets (session/new MCP configs
// include the comms token, Composio key, CUA spec). The values are never the
// point of the debug log — mask them before anything reaches disk.
const SECRET_KEYS = new Set(["env", "headers", "header", "authorization", "token", "apikey", "api_key"]);

function redactForNativeLog(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactForNativeLog(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (SECRET_KEYS.has(lowered) && child !== null && typeof child === "object") {
      out[key] = Array.isArray(child)
        ? child.map((entry) =>
            entry && typeof entry === "object" && "value" in (entry as Record<string, unknown>)
              ? { ...(entry as Record<string, unknown>), value: "***" }
              : "***",
          )
        : Object.fromEntries(Object.keys(child as Record<string, unknown>).map((name) => [name, "***"]));
    } else if (SECRET_KEYS.has(lowered) && typeof child === "string") {
      out[key] = "***";
    } else {
      out[key] = redactForNativeLog(child, depth + 1);
    }
  }
  return out;
}

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  if (!nativeLogEnabled()) return;
  try {
    appendNdjson(NATIVE_DIR, threadId, { at: new Date().toISOString(), ...entry, msg: redactForNativeLog(entry.msg) });
  } catch {
    /* never let logging break a run */
  }
}
