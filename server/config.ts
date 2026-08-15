// Config + data dirs. One file, ~/.nexbot/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
// Secret fields are AES-256-GCM envelopes on disk (see secret-crypto.ts).
// GET /api/config still returns configured-or-not booleans only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstanceConfigMap } from "./contracts.ts";
import { decryptSecret, encryptSecret, isSecretEnvelope } from "./secret-crypto.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  /** key = ck_… Connect consumer key (connections + agent tools);
   * apiKey = ak_… project API key — optional, unlocks the full toolkit
   * catalog with official logos in Connectors. */
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: { token?: string };
  /** The local profile and workspace brand (collected in onboarding,
   * shown in the sidebar). Not a secret — echoed back by GET /api/config. */
  profile?: { name?: string; email?: string; companyName?: string };
  /** Optional private LAN mode for NexBot Connect. */
  remoteAccess?: { mode?: "off" | "lan" };
  instances?: InstanceConfigMap;
}

/** Override the local data root for isolated previews and integration tests. */
export const DATA_DIR = process.env.NEXBOT_DATA_DIR?.trim()
  ? resolve(process.env.NEXBOT_DATA_DIR)
  : join(homedir(), ".nexbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
const LOCAL_ENV_FILE = join(DATA_DIR, ".env");

const SECRET_FIELDS = {
  xai: ["key"],
  composio: ["key", "apiKey"],
  box: ["token"],
} as const;

type SecretSection = keyof typeof SECRET_FIELDS;

export function ensureDirs() {
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) mkdirSync(dir, { recursive: true });
}

function configPath(): string {
  return join(DATA_DIR, "config.json");
}

/** Read the local wipe password without ever returning it through config APIs. */
export function wipePassword(): string | null {
  const fromProcess = process.env.NEXBOT_WIPE_PASSWORD?.trim();
  if (fromProcess) return fromProcess;
  try {
    const line = readFileSync(LOCAL_ENV_FILE, "utf8")
      .split(/\r?\n/)
      .find((row) => /^\s*NEXBOT_WIPE_PASSWORD\s*=/.test(row));
    if (!line) return null;
    const value = line.replace(/^\s*NEXBOT_WIPE_PASSWORD\s*=\s*/, "").trim();
    return value.replace(/^(["'])(.*)\1$/, "$2").trim() || null;
  } catch {
    return null;
  }
}

function readDisk(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeDisk(disk: Record<string, unknown>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(disk, null, 2));
}

function isSecretSection(key: string): key is SecretSection {
  return key in SECRET_FIELDS;
}

function decryptSection<K extends SecretSection>(
  key: K,
  raw: Record<string, unknown> | undefined,
): AppConfig[K] {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, unknown> = { ...raw };
  for (const field of SECRET_FIELDS[key]) {
    if (!(field in out)) continue;
    const plain = decryptSecret(out[field]);
    if (plain === undefined) delete out[field];
    else out[field] = plain;
  }
  return out as AppConfig[K];
}

/** True when a secret field is still a legacy plaintext string. */
function diskHasPlaintextSecrets(disk: Record<string, unknown>): boolean {
  for (const [section, fields] of Object.entries(SECRET_FIELDS)) {
    const raw = disk[section];
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    for (const field of fields) {
      const value = rec[field];
      if (typeof value === "string" && value.length > 0) return true;
    }
  }
  return false;
}

function encryptPlaintextSecrets(disk: Record<string, unknown>): void {
  for (const [section, fields] of Object.entries(SECRET_FIELDS)) {
    const raw = disk[section];
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    for (const field of fields) {
      const value = rec[field];
      if (typeof value === "string" && value.length > 0) {
        rec[field] = encryptSecret(value);
      }
    }
  }
}

export function loadConfig(): AppConfig {
  let disk = readDisk();
  if (diskHasPlaintextSecrets(disk)) {
    encryptPlaintextSecrets(disk);
    writeDisk(disk);
  }
  const cfg: AppConfig = {
    xai: decryptSection("xai", disk.xai as Record<string, unknown> | undefined),
    composio: decryptSection("composio", disk.composio as Record<string, unknown> | undefined),
    box: decryptSection("box", disk.box as Record<string, unknown> | undefined),
    profile: (disk.profile as AppConfig["profile"]) ?? undefined,
    remoteAccess: (disk.remoteAccess as AppConfig["remoteAccess"]) ?? undefined,
    instances: (disk.instances as InstanceConfigMap) ?? undefined,
  };
  cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
  cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
  cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  return cfg;
}

/** Merge a partial config into ~/.nexbot/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only).
 * Empty string or null on a secret field deletes it. */
export function saveConfig(patch: Partial<AppConfig>): void {
  const disk = readDisk();
  for (const key of ["xai", "composio", "box", "profile", "remoteAccess"] as const) {
    const incoming = patch[key];
    if (!incoming || typeof incoming !== "object") continue;
    const current = { ...((disk[key] as object) || {}) } as Record<string, unknown>;
    for (const [field, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (isSecretSection(key) && (SECRET_FIELDS[key] as readonly string[]).includes(field)) {
        if (value === null || value === "") {
          delete current[field];
        } else if (typeof value === "string") {
          current[field] = encryptSecret(value);
        } else if (isSecretEnvelope(value)) {
          current[field] = value;
        }
        continue;
      }
      current[field] = value;
    }
    disk[key] = current;
  }
  writeDisk(disk);
}

// Default fleet: one instance per built-in driver.
// instanceId defaults to the driver kind.
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The default `grok` instance rides the `grokAgent` driver, not the API-key
  // one: like claude and codex it needs no credential from us, just the CLI
  // installed and logged in (it shows up unavailable otherwise). The API-key
  // `grok` driver stays registered but out of the default fleet — that key is
  // a credential NexBot does not manage by default; an `instances` entry brings
  // it back anytime.
  const defaultMap: InstanceConfigMap = {
    grok: { driver: "grokAgent" },
    gemini: { driver: "geminiAgent" },
    antigravity: { driver: "antigravity" },
    claude: { driver: "claudeAgent" },
    codex: { driver: "codex" },
  };
  // Cloud Box is not part of NexBot's product surface. Ignore legacy
  // boxAgent entries so the picker and provider status stay local-only.
  const configuredMap = cfg.instances && Object.keys(cfg.instances).length
    ? Object.fromEntries(Object.entries(cfg.instances).filter(([, entry]) => entry.driver !== "boxAgent"))
    : {};
  const map: InstanceConfigMap = Object.keys(configuredMap).length ? configuredMap : defaultMap;
  for (const entry of Object.values(map)) {
    entry.environment = {
      ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
      ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
      ...entry.environment,
    };
  }
  return map;
}
