// LAN / off-loopback harness auth.
// Loopback clients stay trusted (local desktop). Anything else must present
// the harness token — or, for the small phone surface, the steer token.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function requestIsLoopback(req: Pick<IncomingMessage, "socket">): boolean {
  // Test hook: treat every request as remote so unit/integration tests can
  // exercise the 401 path without a second NIC.
  if (process.env.NEXBOT_TEST_REMOTE === "1") return false;
  return isLoopbackAddress(req.socket.remoteAddress);
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
