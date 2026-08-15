// At-rest encryption for ~/.nexbot/config.json secrets.
// AES-256-GCM envelopes; wrapping key lives in ~/.nexbot/master.key.
// On Windows the wrapping key is DPAPI-protected (CurrentUser) when possible.
// Never log the wrapping key or a decrypted secret.
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";

import { DATA_DIR } from "./config.ts";

export const SECRET_MARK = 1;
const DPAPI_PREFIX = "DPAPI1:";
const RAW_PREFIX = "RAW1:";

export type SecretEnvelope = {
  __nex: typeof SECRET_MARK;
  iv: string;
  tag: string;
  ct: string;
};

let cachedKey: Buffer | null = null;

function keyPath(): string {
  return join(DATA_DIR, "master.key");
}

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as SecretEnvelope;
  return (
    v.__nex === SECRET_MARK &&
    typeof v.iv === "string" &&
    v.iv.length > 0 &&
    typeof v.tag === "string" &&
    v.tag.length > 0 &&
    typeof v.ct === "string" &&
    v.ct.length > 0
  );
}

function restrictKeyFile(file: string): void {
  if (process.platform === "win32") {
    try {
      const user = process.env.USERNAME || userInfo().username;
      execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:(R,W)`], {
        timeout: 10_000,
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      /* best effort — file still exists */
    }
    return;
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

function dpapiProtect(plain: Buffer): Buffer | null {
  if (process.platform !== "win32") return null;
  if (process.env.VITEST || process.env.NEXBOT_PLAIN_MASTER_KEY === "1") return null;
  try {
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$in = New-Object System.IO.MemoryStream",
      "[Console]::OpenStandardInput().CopyTo($in)",
      "$prot = [System.Security.Cryptography.ProtectedData]::Protect($in.ToArray(), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Console]::OpenStandardOutput().Write($prot, 0, $prot.Length)",
    ].join("; ");
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      input: plain,
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1_000_000,
    });
    return Buffer.isBuffer(out) && out.length ? out : null;
  } catch {
    return null;
  }
}

function dpapiUnprotect(blob: Buffer): Buffer | null {
  if (process.platform !== "win32") return null;
  try {
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$in = New-Object System.IO.MemoryStream",
      "[Console]::OpenStandardInput().CopyTo($in)",
      "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($in.ToArray(), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Console]::OpenStandardOutput().Write($plain, 0, $plain.Length)",
    ].join("; ");
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      input: blob,
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1_000_000,
    });
    return Buffer.isBuffer(out) && out.length ? out : null;
  } catch {
    return null;
  }
}

function persistWrappingKey(key: Buffer): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = keyPath();
  const protectedBlob = dpapiProtect(key);
  if (protectedBlob) {
    writeFileSync(file, DPAPI_PREFIX + protectedBlob.toString("base64"), { encoding: "utf8", mode: 0o600 });
  } else {
    writeFileSync(file, RAW_PREFIX + key.toString("base64"), { encoding: "utf8", mode: 0o600 });
  }
  restrictKeyFile(file);
}

function readWrappingKey(): Buffer | null {
  const file = keyPath();
  if (!existsSync(file)) return null;
  const raw = readFileSync(file);
  const text = raw.toString("utf8").trim();
  if (text.startsWith(DPAPI_PREFIX)) {
    const blob = Buffer.from(text.slice(DPAPI_PREFIX.length), "base64");
    const plain = dpapiUnprotect(blob);
    if (plain && plain.length === 32) return plain;
    return null;
  }
  if (text.startsWith(RAW_PREFIX)) {
    const key = Buffer.from(text.slice(RAW_PREFIX.length), "base64");
    return key.length === 32 ? key : null;
  }
  // legacy: raw 32-byte file
  if (raw.length === 32) return raw;
  return null;
}

export function resetSecretCryptoForTests(): void {
  cachedKey = null;
}

export function getMasterKey(): Buffer {
  if (cachedKey && existsSync(keyPath())) return cachedKey;
  const existing = readWrappingKey();
  if (existing) {
    cachedKey = existing;
    return existing;
  }
  const key = randomBytes(32);
  persistWrappingKey(key);
  cachedKey = key;
  return key;
}

export function encryptSecret(plain: string): SecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    __nex: SECRET_MARK,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

/** Decrypt an envelope, or pass through a legacy plaintext string. */
export function decryptSecret(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isSecretEnvelope(value)) return undefined;
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ct, "base64")), decipher.final()]).toString("utf8");
}
