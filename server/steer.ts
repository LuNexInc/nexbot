// Signed phone / chat steer. Token lives in ~/.nexbot/steer.json.
// Desktop UI does not need it. /m.html and POST /api/steer do.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

const FILE = join(DATA_DIR, "steer.json");

export type SteerFile = { token: string };

export function loadSteerToken(): string {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as SteerFile;
    if (raw.token && typeof raw.token === "string") return raw.token;
  } catch {
    /* first run */
  }
  return rotateSteerToken();
}

export function rotateSteerToken(): string {
  const token = randomBytes(24).toString("hex");
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ token }, null, 2));
  return token;
}

export function checkSteerToken(provided: string | undefined | null): boolean {
  if (!provided) return false;
  const want = existsSync(FILE) ? loadSteerToken() : "";
  if (!want || provided.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= provided.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export function tokenFromRequest(authHeader: string | undefined, queryToken: string | null): string | undefined {
  if (queryToken) return queryToken;
  if (!authHeader) return undefined;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}
