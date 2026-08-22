// LAN / off-loopback harness auth.
// Loopback clients stay trusted (local desktop). Anything else must present
// the harness token — or, for the small phone surface, the steer token.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { tokenFromRequest } from "./steer.ts";

const FILE = () => join(DATA_DIR, "harness.json");

export type HarnessFile = { token: string };

export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const ip = addr.replace(/^::ffff:/i, "").replace(/^\[|\]$/g, "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

export function bindIsOffLoopback(bind: string): boolean {
  return Boolean(bind) && !isLoopbackAddress(bind);
}

export function requestIsLoopback(req: Pick<IncomingMessage, "socket" | "headers">): boolean {
  // Test hook: treat every request as remote so unit/integration tests can
  // exercise the 401 path without a second NIC.
  if (process.env.NEXBOT_TEST_REMOTE === "1") return false;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return isLoopbackAddress(forwarded.split(",", 1)[0].trim());
  }
  return true;
}

export function loadHarnessToken(): string {
  try {
    const raw = JSON.parse(readFileSync(FILE(), "utf8")) as HarnessFile;
    if (raw.token && typeof raw.token === "string") return raw.token;
  } catch {
    /* first run */
  }
  return rotateHarnessToken();
}

export function rotateHarnessToken(): string {
  const token = randomBytes(24).toString("hex");
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE(), JSON.stringify({ token }, null, 2));
  return token;
}

export function checkHarnessToken(provided: string | undefined | null): boolean {
  if (!provided) return false;
  const want = existsSync(FILE()) ? loadHarnessToken() : "";
  if (!want || provided.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(want));
}

export function isPublicHarnessPath(method: string, path: string): boolean {
  if (method === "GET" && path === "/api/health") return true;
  if (path.startsWith("/api/webhooks/")) return true;
  if (path.startsWith("/api/routines/hooks/")) return true;
  if (path.startsWith("/api/internal/")) return true;
  if (!path.startsWith("/api/")) return true;
  return false;
}

/** Phone / LAN surface that already has its own steer token. */
export function isSteerLanPath(method: string, path: string): boolean {
  if (method === "POST" && path === "/api/steer/jobs") return true;
  if (method === "GET" && path === "/api/steer/bots") return true;
  if (method === "GET" && path === "/api/events") return true;
  return false;
}

export type HarnessGate = { ok: true } | { ok: false; error: string };

export function authorizeHarnessRequest(
  req: IncomingMessage,
  method: string,
  path: string,
  providedToken: string | undefined,
  steerOk: boolean,
): HarnessGate {
  if (requestIsLoopback(req)) return { ok: true };
  if (isPublicHarnessPath(method, path)) return { ok: true };
  if (isSteerLanPath(method, path) && steerOk) return { ok: true };
  if (checkHarnessToken(providedToken)) return { ok: true };
  return { ok: false, error: "harness token required" };
}

export function tokenFromHarnessRequest(
  authHeader: string | undefined,
  queryToken: string | null,
): string | undefined {
  return tokenFromRequest(authHeader, queryToken);
}

// ── browser cross-site defense ─────────────────────────────────────────
// The server sends no CORS headers, so a normal cross-origin page cannot
// read responses. DNS rebinding defeats that: a hostile domain that resolves
// to 127.0.0.1 makes the attack same-origin while loopback stays "trusted".
// Validate the Host header, and — when the browser volunteers them — Origin,
// Referer, and Sec-Fetch-Site. Non-browser clients (curl, the Electron
// shell, the proxies) always send a correct Host and no Origin, so only a
// rebound or malicious page is rejected.
let localHostnameCache: { at: number; names: Set<string> } | null = null;

function localHostnames(bind: string): Set<string> {
  const now = Date.now();
  if (localHostnameCache && now - localHostnameCache.at < 60_000) return localHostnameCache.names;
  const names = new Set(["127.0.0.1", "localhost", "::1"]);
  const bindHost = bind.replace(/^\[|\]$/g, "").trim().toLowerCase();
  if (bindHost) names.add(bindHost);
  try {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.address) names.add(addr.address.split("%")[0]!.toLowerCase());
      }
    }
  } catch {
    /* interfaces unavailable — loopback names still apply */
  }
  localHostnameCache = { at: now, names };
  return names;
}

function hostnameAllowed(hostname: string, bind: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();
  if (!host) return false;
  return localHostnames(bind).has(host);
}

function originAllowed(origin: string, bind: string): boolean {
  try {
    return hostnameAllowed(new URL(origin).hostname, bind);
  } catch {
    return false;
  }
}

/** True when the request carries browser headers pointing at another site —
 * a cross-origin page or a DNS-rebound domain. Host is mandatory in HTTP/1.1,
 * so a missing Host is treated as hostile too. */
export function requestLooksCrossSite(
  req: Pick<IncomingMessage, "headers">,
  bind: string,
): boolean {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site === "cross-site") return true;
  const host = req.headers.host;
  if (typeof host !== "string" || !host.trim()) return true;
  if (!hostnameAllowed(host.replace(/:\d+$/, ""), bind)) return true;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin && origin !== "null" && !originAllowed(origin, bind)) return true;
  const referer = req.headers.referer;
  if (typeof referer === "string" && referer) {
    try {
      if (!hostnameAllowed(new URL(referer).hostname, bind)) return true;
    } catch {
      /* malformed referer — the Host check already decided */
    }
  }
  return false;
}
