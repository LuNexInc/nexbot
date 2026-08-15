// Private NexBot Connect device access.
// Store only token digests on disk. Return a raw token only when a device is
// created or rotated so the pairing link can be copied once.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

import { DATA_DIR, type AppConfig } from "./config.ts";

export type RemoteAccessMode = "off" | "lan";

export interface RemoteDevice {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  tokenPrefix: string;
  tokenHash: string;
}

export interface RemoteDeviceStatus extends Omit<RemoteDevice, "tokenHash"> {
  active: boolean;
}

export interface CreatedPairingCode {
  code: string;
  label: string;
  deviceId?: string;
  createdAt: number;
  expiresAt: number;
}

interface PendingPairingCode {
  codeHash: string;
  label: string;
  deviceId?: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

interface RemoteAccessFile {
  version: 1;
  devices: RemoteDevice[];
  pairingCodes?: PendingPairingCode[];
}

export interface RemoteAccessStatus {
  mode: RemoteAccessMode;
  enabled: boolean;
  bind: string;
  configuredBind: string;
  restartRequired: boolean;
  port: number;
  lanAddresses: string[];
  devices: RemoteDeviceStatus[];
}

export interface CreatedRemoteDevice {
  device: RemoteDeviceStatus;
  token: string;
}

export const REMOTE_ACCESS_FILE = join(DATA_DIR, "remote-access.json");

function readFile(): RemoteAccessFile {
  try {
    const parsed = JSON.parse(readFileSync(REMOTE_ACCESS_FILE, "utf8")) as Partial<RemoteAccessFile>;
    if (parsed.version === 1 && Array.isArray(parsed.devices)) {
      return {
        version: 1,
        devices: parsed.devices.filter(isDevice),
        pairingCodes: Array.isArray(parsed.pairingCodes) ? parsed.pairingCodes.filter(isPairingCode) : [],
      };
    }
  } catch {
    // First run or a partially written file.
  }
  return { version: 1, devices: [], pairingCodes: [] };
}

function isDevice(value: unknown): value is RemoteDevice {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RemoteDevice>;
  return (
    typeof row.id === "string" &&
    typeof row.label === "string" &&
    typeof row.createdAt === "number" &&
    typeof row.tokenPrefix === "string" &&
    typeof row.tokenHash === "string"
  );
}

function isPairingCode(value: unknown): value is PendingPairingCode {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingPairingCode>;
  return (
    typeof row.codeHash === "string" &&
    typeof row.label === "string" &&
    (row.deviceId === undefined || typeof row.deviceId === "string") &&
    typeof row.createdAt === "number" &&
    typeof row.expiresAt === "number" &&
    typeof row.attempts === "number"
  );
}

function writeFile(file: RemoteAccessFile): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(REMOTE_ACCESS_FILE, JSON.stringify(file, null, 2), { mode: 0o600 });
}

function digest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicDevice(device: RemoteDevice): RemoteDeviceStatus {
  const { tokenHash: _tokenHash, ...safe } = device;
  return { ...safe, active: !device.revokedAt };
}

function normalizeLabel(label: unknown, fallback: string): string {
  const value = typeof label === "string" ? label.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  return value || fallback;
}

export function listRemoteDevices(): RemoteDeviceStatus[] {
  return readFile().devices.sort((a, b) => a.createdAt - b.createdAt).map(publicDevice);
}

export function createRemoteDevice(label?: unknown): CreatedRemoteDevice {
  const file = readFile();
  const token = `nx_${randomBytes(32).toString("hex")}`;
  const device: RemoteDevice = {
    id: `device_${randomBytes(8).toString("hex")}`,
    label: normalizeLabel(label, `Device ${file.devices.length + 1}`),
    createdAt: Date.now(),
    tokenPrefix: token.slice(0, 11),
    tokenHash: digest(token),
  };
  file.devices.push(device);
  writeFile(file);
  return { device: publicDevice(device), token };
}

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_MAX_ATTEMPTS = 5;

function sixDigitCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function prunePairingCodes(file: RemoteAccessFile, now = Date.now()): void {
  file.pairingCodes = (file.pairingCodes ?? []).filter((row) => row.expiresAt > now && row.attempts < PAIRING_CODE_MAX_ATTEMPTS);
}

/** Create a short-lived code. Only its digest is stored on disk. */
export function createPairingCode(label?: unknown, deviceId?: string): CreatedPairingCode {
  const file = readFile();
  const now = Date.now();
  prunePairingCodes(file, now);
  let code = sixDigitCode();
  while ((file.pairingCodes ?? []).some((row) => sameDigest(row.codeHash, digest(code)))) code = sixDigitCode();
  const normalizedLabel = normalizeLabel(label, "Android device");
  const expiresAt = now + PAIRING_CODE_TTL_MS;
  file.pairingCodes!.push({ codeHash: digest(code), label: normalizedLabel, deviceId, createdAt: now, expiresAt, attempts: 0 });
  writeFile(file);
  return { code, label: normalizedLabel, deviceId, createdAt: now, expiresAt };
}

/** Consume a code once, returning its suggested label and optional device id. */
export function consumePairingCode(rawCode: unknown): { label: string; deviceId?: string } | null {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(code)) return null;
  const file = readFile();
  const now = Date.now();
  prunePairingCodes(file, now);
  const index = file.pairingCodes!.findIndex((row) => sameDigest(row.codeHash, digest(code)));
  if (index < 0) {
    writeFile(file);
    return null;
  }
  const pending = file.pairingCodes![index];
  pending.attempts += 1;
  file.pairingCodes!.splice(index, 1);
  writeFile(file);
  return { label: pending.label, deviceId: pending.deviceId };
}

export function rotateRemoteDevice(id: string): CreatedRemoteDevice | null {
  const file = readFile();
  const device = file.devices.find((row) => row.id === id);
  if (!device || device.revokedAt) return null;
  const token = `nx_${randomBytes(32).toString("hex")}`;
  device.tokenPrefix = token.slice(0, 11);
  device.tokenHash = digest(token);
  device.lastUsedAt = undefined;
  writeFile(file);
  return { device: publicDevice(device), token };
}

export function revokeRemoteDevice(id: string): RemoteDeviceStatus | null {
  const file = readFile();
  const device = file.devices.find((row) => row.id === id);
  if (!device) return null;
  if (!device.revokedAt) device.revokedAt = Date.now();
  writeFile(file);
  return publicDevice(device);
}

/** Authenticate a device token and update its local last-used timestamp. */
export function authenticateRemoteToken(token: string | undefined | null): RemoteDeviceStatus | null {
  if (!token) return null;
  const file = readFile();
  const device = file.devices.find((row) => !row.revokedAt && sameDigest(row.tokenHash, digest(token)));
  if (!device) return null;
  device.lastUsedAt = Date.now();
  writeFile(file);
  return publicDevice(device);
}

export function localIpv4Addresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family;
      if ((family === "IPv4" || String(family) === "4") && !entry.internal) addresses.add(entry.address);
    }
  }
  return [...addresses].sort();
}

export function configuredBind(cfg: Pick<AppConfig, "remoteAccess">): string {
  return cfg.remoteAccess?.mode === "lan" ? "0.0.0.0" : "127.0.0.1";
}

export function remoteAccessMode(cfg: Pick<AppConfig, "remoteAccess">): RemoteAccessMode {
  return cfg.remoteAccess?.mode === "lan" ? "lan" : "off";
}

export function remoteAccessEnabled(cfg: Pick<AppConfig, "remoteAccess">, currentBind: string): boolean {
  return remoteAccessMode(cfg) === "lan" || !["127.0.0.1", "::1", "localhost"].includes(currentBind.toLowerCase());
}

export function remoteAccessStatus(
  cfg: Pick<AppConfig, "remoteAccess">,
  currentBind = configuredBind(cfg),
  port = Number(process.env.NEXBOT_PORT || 8799),
): RemoteAccessStatus {
  const mode = remoteAccessMode(cfg);
  const desiredBind = configuredBind(cfg);
  return {
    mode,
    enabled: remoteAccessEnabled(cfg, currentBind),
    bind: currentBind,
    configuredBind: desiredBind,
    restartRequired: currentBind !== desiredBind,
    port,
    lanAddresses: localIpv4Addresses(),
    devices: listRemoteDevices(),
  };
}

export function pairingUrls(token: string, port: number, addresses = localIpv4Addresses()): string[] {
  const hosts = addresses.length ? addresses : ["127.0.0.1"];
  return hosts.map((host) => `http://${host}:${port}/?token=${encodeURIComponent(token)}`);
}

export function pairingMobileUrls(token: string, port: number, addresses = localIpv4Addresses()): string[] {
  const hosts = addresses.length ? addresses : ["127.0.0.1"];
  return hosts.map((host) => `http://${host}:${port}/m.html?token=${encodeURIComponent(token)}`);
}

/** QR payloads for the native Connect app. They carry a host and short code, never a device token. */
export function pairingCodeUrls(code: string, port: number, addresses = localIpv4Addresses()): string[] {
  const hosts = addresses.length ? [...addresses].sort((a, b) => addressPriority(a) - addressPriority(b)) : ["127.0.0.1"];
  return hosts.map((host) => {
    const base = `http://${host}:${port}`;
    return `nexbot://pair?url=${encodeURIComponent(base)}&code=${encodeURIComponent(code)}`;
  });
}

function addressPriority(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  if (address.startsWith("100.")) return 3;
  return 4;
}

export function remoteAccessFileExists(): boolean {
  return existsSync(REMOTE_ACCESS_FILE);
}
