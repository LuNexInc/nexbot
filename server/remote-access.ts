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

interface RemoteAccessFile {
  version: 1;
  devices: RemoteDevice[];
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
      return { version: 1, devices: parsed.devices.filter(isDevice) };
    }
  } catch {
    // First run or a partially written file.
  }
  return { version: 1, devices: [] };
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

export function remoteAccessFileExists(): boolean {
  return existsSync(REMOTE_ACCESS_FILE);
}
